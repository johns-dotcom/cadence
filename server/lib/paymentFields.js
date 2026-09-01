/**
 * What we need in order to actually pay a vendor, per payment method — and
 * whether what they typed agrees with what their invoice says.
 *
 * Ported from boom-dashboard lib/payment-fields.js. Everything here is PURE —
 * the doc side of the comparison comes from an AI extraction and a verdict that
 * can only be exercised against a live model is a verdict nobody tests. The
 * route wires this up.
 *
 * One definition, two callers: the public submit route enforces this; the
 * browser holds its own copy of the field LIST for rendering, but the server is
 * the authority.
 */

/** The three methods the public form offers. Anything else is refused outright. */
const PAYMENT_METHODS = ['ACH', 'Wire', 'PayPal'];

const FIELDS_BY_METHOD = {
  ACH: [
    { key: 'payment_account_number', label: 'account number' },
    { key: 'payment_routing_number', label: 'routing number' },
    { key: 'payment_account_type',   label: 'account type (checking or savings)' },
    { key: 'payment_holder_name',    label: 'name on the account' },
    { key: 'payment_bank_name',      label: 'bank name' },
    { key: 'payment_bank_address',   label: 'bank address' },
  ],
  // Wire is NOT a flat list — see FIELDS_BY_WIRE_SCOPE. `fieldsFor()` is the
  // accessor; reading FIELDS_BY_METHOD.Wire directly gets you undefined, on
  // purpose, so a caller that has not been taught about the scope fails loudly.
  PayPal: [
    { key: 'payment_paypal', label: 'PayPal email or handle' },
  ],
};

/**
 * A wire is two different instruments wearing one name. A DOMESTIC US wire is
 * an ABA routing number plus an account number — no IBAN, no SWIFT to give. An
 * INTERNATIONAL wire needs an IBAN or SWIFT/BIC and the addresses actually
 * matter. So the vendor is asked WHERE THEIR BANK IS first, and the rest
 * follows from that answer.
 */
const WIRE_SCOPES = ['Domestic', 'International'];

const FIELDS_BY_WIRE_SCOPE = {
  Domestic: [
    { key: 'payment_routing_number', label: 'routing number (ABA)' },
    { key: 'payment_account_number', label: 'account number' },
    { key: 'payment_holder_name',    label: 'name on the account' },
    { key: 'payment_bank_name',      label: 'bank name' },
    // Bank address and beneficiary address are OPTIONAL here — the ABA already
    // identifies the bank.
  ],
  International: [
    { key: 'payment_iban_swift',          label: 'IBAN or SWIFT/BIC code' },
    { key: 'payment_holder_name',         label: 'name on the account' },
    { key: 'payment_bank_name',           label: 'bank name' },
    { key: 'payment_bank_address',        label: 'bank address' },
    { key: 'payment_beneficiary_address', label: 'beneficiary address' },
    // Account number is conditionally required — see validatePaymentFields. An
    // IBAN CONTAINS the account number; a SWIFT/BIC identifies only the bank.
  ],
};

/** The required field list for a submission. Wire depends on its scope. */
function fieldsFor(method, values = {}) {
  if (method !== 'Wire') return FIELDS_BY_METHOD[method] || [];
  const scope = matchWireScope(values.payment_wire_scope);
  return scope ? FIELDS_BY_WIRE_SCOPE[scope] : [];
}

/** Optional fields — rendered and stored, never required. */
const OPTIONAL_FIELDS_BY_METHOD = {
  ACH: [],
  Wire: [{ key: 'payment_intermediary_bank', label: 'intermediary / correspondent bank' }],
  PayPal: [],
};

/** ACH files carry a different transaction code for checking vs savings. */
const ACCOUNT_TYPES = ['Checking', 'Savings'];

/** Accept "domestic" / "US" / "intl" etc. and return the canonical value or ''. */
function matchWireScope(v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return '';
  if (t.startsWith('dom') || t === 'us' || t === 'usa' || t === 'united states') return 'Domestic';
  if (t.startsWith('int') || t.startsWith('for') || t.startsWith('abroad')) return 'International';
  return '';
}

const clean = (s) => String(s ?? '').trim();
/** Digits only — account and routing numbers are written with spaces and dashes. */
const digits = (s) => clean(s).replace(/[^0-9]/g, '');
/** Letters and digits, upper-cased — how IBAN and SWIFT are compared. */
const alnum = (s) => clean(s).replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/**
 * ABA checksum. Nine digits with a weighted mod-10 check, so a single mistyped
 * digit is catchable — and worth catching, because the failure mode otherwise
 * is a payment that bounces days later, or lands somewhere else.
 */
function validAba(routing) {
  const d = digits(routing);
  if (d.length !== 9) return false;
  const n = d.split('').map(Number);
  const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
  return sum % 10 === 0;
}

/** IBAN: 2 country letters, 2 check digits, then up to 30 alphanumerics. */
const looksLikeIban = (v) => /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(alnum(v));
/** SWIFT/BIC: 8 or 11 characters, bank(4) country(2) location(2) [branch(3)]. */
const looksLikeSwift = (v) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(alnum(v));

/** Accept "checking" / "CHK" etc.; return canonical 'Checking'|'Savings' or ''. */
function matchAccountType(v) {
  const s = clean(v).toLowerCase();
  if (!s) return '';
  if (s.startsWith('check') || s === 'chk') return 'Checking';
  if (s.startsWith('sav') || s === 'svg') return 'Savings';
  return '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** PayPal is reached by an email address or an @handle — accept either. */
const looksLikePaypal = (v) => {
  const s = clean(v);
  if (EMAIL_RE.test(s)) return true;
  return /^@?[A-Za-z0-9._-]{3,}$/.test(s);
};

/**
 * Validate the payment block for a method.
 *
 * @returns {{ ok: boolean, errors: string[], normalized: object }}
 *   `errors` are vendor-facing sentences, in field order, so the first one is
 *   also the sensible single message for a 400.
 */
function validatePaymentFields(method, values = {}) {
  const errors = [];
  if (!PAYMENT_METHODS.includes(method)) {
    return { ok: false, errors: ['Please select your preferred payment method.'], normalized: {} };
  }
  // Wire needs its scope before anything else can be asked for. Refused first
  // and alone, so a domestic vendor is never shown a demand for an IBAN.
  if (method === 'Wire') {
    const scope = matchWireScope(values.payment_wire_scope);
    if (!scope) {
      return {
        ok: false,
        errors: ['Please tell us whether your bank is in the US (domestic wire) or outside the US (international wire).'],
        normalized: {},
      };
    }
  }

  const spec = fieldsFor(method, values);
  const normalized = {};

  for (const f of spec) {
    if (!clean(values[f.key])) {
      errors.push(`Please enter your ${f.label} — we cannot pay you without it.`);
    }
  }
  // Shape checks run only on fields that were actually provided, so a vendor
  // never sees "that isn't a valid routing number" about a box they left empty.
  if (method === 'ACH') {
    const acct = digits(values.payment_account_number);
    const rout = digits(values.payment_routing_number);
    if (clean(values.payment_account_number) && (acct.length < 4 || acct.length > 17)) {
      errors.push('That account number does not look right — US account numbers are 4 to 17 digits.');
    }
    if (clean(values.payment_routing_number) && !validAba(rout)) {
      errors.push('That routing number does not look right — it should be the 9-digit ABA number on the bottom of a check.');
    }
    const type = matchAccountType(values.payment_account_type);
    if (clean(values.payment_account_type) && !type) {
      errors.push('Please choose whether that is a checking or a savings account.');
    }
    normalized.account_number = acct;
    normalized.routing_number = rout;
    normalized.account_type = type;
    normalized.holder_name = clean(values.payment_holder_name);
    normalized.bank_name = clean(values.payment_bank_name);
    normalized.bank_address = clean(values.payment_bank_address);
  } else if (method === 'Wire') {
    const scope = matchWireScope(values.payment_wire_scope);
    normalized.wire_scope = scope;
    normalized.holder_name = clean(values.payment_holder_name);
    normalized.bank_name = clean(values.payment_bank_name);
    normalized.bank_address = clean(values.payment_bank_address);
    normalized.beneficiary_address = clean(values.payment_beneficiary_address);
    normalized.intermediary_bank = clean(values.payment_intermediary_bank);

    if (scope === 'Domestic') {
      // A US wire is an ABA and an account number — same checksum as ACH.
      const acct = digits(values.payment_account_number);
      const rout = digits(values.payment_routing_number);
      if (clean(values.payment_account_number) && (acct.length < 4 || acct.length > 17)) {
        errors.push('That account number does not look right — US account numbers are 4 to 17 digits.');
      }
      if (clean(values.payment_routing_number) && !validAba(rout)) {
        errors.push('That routing number does not look right — it should be the 9-digit ABA number on the bottom of a check.');
      }
      normalized.account_number = acct;
      normalized.routing_number = rout;
      normalized.iban_swift = '';
    } else {
      const v = values.payment_iban_swift;
      const isIban = looksLikeIban(v);
      const isSwift = looksLikeSwift(v);
      if (clean(v) && !isIban && !isSwift) {
        errors.push('That does not look like an IBAN or a SWIFT/BIC code. IBANs start with two letters and two digits; SWIFT codes are 8 or 11 characters.');
      }
      // Conditionally required: an IBAN already CONTAINS the account number; a
      // SWIFT/BIC names only the bank, so without an account number the payment
      // has no destination.
      const wireAcct = clean(values.payment_account_number);
      if (isSwift && !isIban && !wireAcct) {
        errors.push('Please enter your account number — a SWIFT/BIC code identifies your bank but not your account.');
      }
      // The US 4-to-17-DIGIT rule is deliberately NOT applied here — foreign
      // account numbers carry letters and run longer.
      if (wireAcct && alnum(wireAcct).length < 4) {
        errors.push('That account number does not look right — it is too short.');
      }
      normalized.iban_swift = alnum(v);
      normalized.account_number = alnum(wireAcct);
      normalized.routing_number = '';
    }
  } else {
    const v = values.payment_paypal;
    if (clean(v) && !looksLikePaypal(v)) {
      errors.push('That does not look like a PayPal email address or handle.');
    }
    normalized.paypal = clean(v).replace(/^@/, '');
  }
  return { ok: errors.length === 0, errors, normalized };
}

/** The value a method is identified by — what gets masked, compared and shown. */
function primaryValue(method, normalized = {}) {
  if (method === 'ACH') return normalized.account_number || '';
  // A DOMESTIC wire has no IBAN, so identity falls back to the account number —
  // without this, payment_last4 is null for every domestic wire and the
  // changed_from flag can never fire.
  if (method === 'Wire') return normalized.iban_swift || normalized.account_number || '';
  return normalized.paypal || '';
}

/** Last four characters of the identifying value — the only part ever displayed. */
function last4(method, normalized = {}) {
  const v = primaryValue(method, normalized);
  return v ? String(v).slice(-4) : null;
}

/**
 * Does what the vendor typed agree with what their invoice shows?
 *
 * Four verdicts:
 *   match      document and form agree — the strongest state.
 *   mismatch   the document says one account, the form another. Flagged for a
 *              human, not blocked.
 *   absent     the document shows nothing for this method — NOT a refusal, it
 *              is the whole reason the form asks.
 *   unscanned  the AI was unavailable. Falls open.
 *
 * @param {string} method
 * @param {object} normalized  from validatePaymentFields
 * @param {object|null} docInfo  the AI extraction, or null/{ok:false}
 */
function comparePaymentDetails(method, normalized, docInfo) {
  const typed = primaryValue(method, normalized);
  const base = { method, typed_last4: typed ? String(typed).slice(-4) : null, doc_last4: null };
  if (!docInfo || docInfo.ok !== true) return { ...base, verdict: 'unscanned' };

  // A DOMESTIC wire prints a routing number and an account number, which the
  // extraction reports as `ach_account_number` — there is no IBAN on the page.
  const isDomesticWire = method === 'Wire' && normalized.wire_scope === 'Domestic';
  const docRaw = method === 'ACH' || isDomesticWire ? docInfo.ach_account_number
    : method === 'Wire' ? docInfo.wire_swift_or_iban
      : docInfo.paypal_identifier;
  const docVal = method === 'PayPal'
    ? clean(docRaw).replace(/^@/, '').toLowerCase()
    : (method === 'ACH' || isDomesticWire ? digits(docRaw) : alnum(docRaw));
  if (!docVal) {
    // The document may still carry a DIFFERENT method's details — say so, so an
    // approver reading "absent" knows whether the invoice was silent or simply
    // paid a different way.
    const others = [
      docInfo.ach_account_number && !isDomesticWire ? 'ACH' : null,
      docInfo.wire_swift_or_iban ? 'Wire' : null,
      docInfo.paypal_identifier ? 'PayPal' : null,
      docInfo.venmo_or_zelle ? 'Venmo/Zelle' : null,
      docInfo.cashapp ? 'CashApp' : null,
      docInfo.check_payable_to ? 'Check' : null,
    ].filter(Boolean).filter((m) => m !== method);
    return { ...base, verdict: 'absent', doc_other_methods: others.length ? others : null };
  }
  const typedCmp = method === 'PayPal' ? String(typed).toLowerCase() : String(typed);
  return {
    ...base,
    doc_last4: docVal.slice(-4),
    verdict: typedCmp === docVal ? 'match' : 'mismatch',
  };
}

module.exports = {
  PAYMENT_METHODS, FIELDS_BY_METHOD, OPTIONAL_FIELDS_BY_METHOD, ACCOUNT_TYPES,
  WIRE_SCOPES, FIELDS_BY_WIRE_SCOPE, fieldsFor,
  validatePaymentFields, comparePaymentDetails, primaryValue, last4,
  validAba, looksLikeIban, looksLikeSwift, looksLikePaypal,
  matchAccountType, matchWireScope,
};
