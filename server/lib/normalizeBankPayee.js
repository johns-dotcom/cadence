// Canonical normalizer for bank-descriptor payees.
//
// Bank descriptors carry per-transaction noise — card codes, phone numbers,
// reference digits — so the SAME recurring charge arrives spelled differently
// every month:
//
//   FACEBK *BXJJYTMFP2 650-543-4800  →  facebk
//   FACEBK *2THTXF                   →  facebk
//
// Dropping those tokens is what makes a descriptor stable enough to key
// anything durable on: the learned match memory, dismissal fingerprints,
// vendor rollups. One definition — both the matcher (lib/bankReconcile.js)
// and report fingerprints (lib/reportFingerprint.js) import it; two copies
// would drift, and a drifted fingerprint silently stops matching, so the
// dismissal quietly comes back.
//
// Token drop rules (digits are COUNTED, not tested for adjacency — codes like
// "7ljz4fdfp2" have scattered digits):
//   * length >= 4 with >= 2 digits anywhere
//   * length >= 5 mixing digits and letters (card code shapes like "2THTXF")
//   * pure digit runs of 4+

const normalizeBankPayee = (s) => String(s || '').toLowerCase()
  .replace(/[*#]/g, ' ')
  .split(/\s+/)
  .filter((w) => w && !(w.length >= 4 && (w.match(/\d/g) || []).length >= 2)
    && !(w.length >= 5 && /\d/.test(w) && /[a-z]/i.test(w))
    && !/^\d{4,}$/.test(w))
  .join(' ')
  .trim();

module.exports = { normalizeBankPayee };
