// NDA template variants for the /create-nda builder. Each template declares a
// field set, a set of optional (toggleable) clauses, and a body builder that
// assembles numbered sections from the field values + enabled clauses.
//
// Mandatory section headings are validated against the (possibly hand-edited)
// body before saving so a user can't accidentally delete a required clause.

const longDate = (d) => {
  if (!d) return '____________'
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`)
  return isNaN(dt) ? '____________' : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}
const val = (v, ph = '____________') => (v && String(v).trim()) ? String(v).trim() : ph

// Shared optional clauses. `heading` is what mandatory/optional detection keys on.
const OPTIONAL = {
  non_solicitation: {
    label: 'Non-solicitation',
    heading: 'NON-SOLICITATION',
    text: 'For a period of one (1) year following disclosure, the Receiving Party shall not directly solicit for employment any employee of the Disclosing Party first identified through the Confidential Information.',
  },
  return_materials: {
    label: 'Return of materials',
    heading: 'RETURN OF MATERIALS',
    text: 'Upon the Disclosing Party’s written request, the Receiving Party shall promptly return or destroy all tangible materials embodying Confidential Information, together with all copies, and certify such destruction in writing.',
  },
  no_publicity: {
    label: 'No publicity',
    heading: 'NO PUBLICITY',
    text: 'Neither party shall issue any press release or public statement regarding this Agreement or the discussions between the parties without the prior written consent of the other party.',
  },
  injunctive_relief: {
    label: 'Injunctive relief',
    heading: 'INJUNCTIVE RELIEF',
    text: 'The Receiving Party acknowledges that any breach of this Agreement may cause irreparable harm for which monetary damages would be inadequate, and that the Disclosing Party shall be entitled to seek injunctive relief in addition to any other remedies available at law or in equity.',
  },
  residuals: {
    label: 'Residuals',
    heading: 'RESIDUALS',
    text: 'Nothing herein shall restrict either party from using general knowledge, skills, and experience retained in the unaided memory of its personnel, provided that no Confidential Information is intentionally memorized for the purpose of retaining or using it.',
  },
}

const partyLine = (t, form) => {
  const eff = longDate(form.effective_date)
  const disc = val(form.disclosing_party, 'DISCLOSING PARTY')
  if (t === 'mutual') {
    const recv = val(form.receiving_party, 'SECOND PARTY')
    return `This Mutual Non-Disclosure Agreement (the “Agreement”) is entered into as of ${eff} by and between ${disc} and ${recv} (each a “Party” and together the “Parties”), who each intend to disclose certain confidential information to the other.`
  }
  if (t === 'corporate') {
    const co = val(form.recipient_company, 'RECIPIENT COMPANY')
    const sig = val(form.recipient_signatory, 'authorized signatory')
    return `This Non-Disclosure Agreement (the “Agreement”) is entered into as of ${eff} by and between ${disc} (the “Disclosing Party”) and ${co}, a corporation acting by its ${sig} (the “Receiving Party”).`
  }
  const recv = val(form.receiving_party, 'RECEIVING PARTY')
  return `This Non-Disclosure Agreement (the “Agreement”) is entered into as of ${eff} by and between ${disc} (the “Disclosing Party”) and ${recv} (the “Receiving Party”).`
}

// Core mandatory sections shared across templates.
const coreSections = (form) => ([
  { heading: 'CONFIDENTIAL INFORMATION', mandatory: true, text: `“Confidential Information” means any non-public information disclosed by one party to the other, whether orally, in writing, or by inspection of tangible objects, including but not limited to unreleased recordings, business plans, financial data, marketing strategies, and the terms of the parties’ discussions concerning ${val(form.purpose, 'the proposed transaction')}.` },
  { heading: 'OBLIGATIONS OF RECEIVING PARTY', mandatory: true, text: 'The Receiving Party shall (a) hold the Confidential Information in strict confidence, (b) not disclose it to any third party without prior written consent, and (c) use it solely for the Purpose. The Receiving Party shall protect the Confidential Information with at least the same degree of care it uses for its own confidential information, and in no event less than reasonable care.' },
  { heading: 'EXCLUSIONS', mandatory: false, text: 'Confidential Information does not include information that (a) is or becomes public through no fault of the Receiving Party, (b) was known to the Receiving Party prior to disclosure, (c) is rightfully received from a third party without duty of confidentiality, or (d) is independently developed without use of the Confidential Information.' },
])

const closingSections = (form) => ([
  { heading: 'TERM', mandatory: true, text: `This Agreement shall remain in effect for ${val(form.term_years, 'two (2)')} year(s) from the Effective Date, and the obligations of confidentiality shall survive any termination for so long as the Confidential Information remains non-public.` },
  { heading: 'GOVERNING LAW', mandatory: true, text: `This Agreement shall be governed by and construed in accordance with the laws of ${val(form.governing_law, 'the applicable jurisdiction')}, without regard to its conflict-of-laws principles.` },
])

export const NDA_TEMPLATES = {
  standard: {
    key: 'standard',
    name: 'Standard (one-way)',
    description: 'One party discloses to another. The classic mutual-trust NDA for vendors, collaborators, and freelancers.',
    fields: [
      { key: 'effective_date', label: 'Effective date', type: 'date' },
      { key: 'disclosing_party', label: 'Disclosing party', required: true },
      { key: 'receiving_party', label: 'Receiving party', required: true },
      { key: 'purpose', label: 'Purpose of disclosure' },
      { key: 'term_years', label: 'Term (years)' },
      { key: 'governing_law', label: 'Governing law (state/country)' },
      { key: 'signatory_name', label: 'Your signatory' },
      { key: 'signatory_title', label: 'Signatory title' },
    ],
    optional: ['exclusions_note', 'return_materials', 'non_solicitation', 'injunctive_relief', 'no_publicity', 'residuals'],
  },
  mutual: {
    key: 'mutual',
    name: 'Mutual',
    description: 'Both parties disclose and receive confidential information. Common for label-to-label or partnership talks.',
    fields: [
      { key: 'effective_date', label: 'Effective date', type: 'date' },
      { key: 'disclosing_party', label: 'First party', required: true },
      { key: 'receiving_party', label: 'Second party', required: true },
      { key: 'purpose', label: 'Purpose of disclosure' },
      { key: 'term_years', label: 'Term (years)' },
      { key: 'governing_law', label: 'Governing law (state/country)' },
      { key: 'signatory_name', label: 'Your signatory' },
      { key: 'signatory_title', label: 'Signatory title' },
    ],
    optional: ['return_materials', 'non_solicitation', 'injunctive_relief', 'no_publicity', 'residuals'],
  },
  corporate: {
    key: 'corporate',
    name: 'Corporate recipient',
    description: 'Recipient is a company acting through an authorized signatory. Adds an entity block and binding-on-affiliates language.',
    fields: [
      { key: 'effective_date', label: 'Effective date', type: 'date' },
      { key: 'disclosing_party', label: 'Disclosing party', required: true },
      { key: 'recipient_company', label: 'Recipient company', required: true },
      { key: 'recipient_signatory', label: 'Recipient signatory / title' },
      { key: 'purpose', label: 'Purpose of disclosure' },
      { key: 'term_years', label: 'Term (years)' },
      { key: 'governing_law', label: 'Governing law (state/country)' },
      { key: 'signatory_name', label: 'Your signatory' },
      { key: 'signatory_title', label: 'Signatory title' },
    ],
    optional: ['affiliates', 'return_materials', 'non_solicitation', 'injunctive_relief', 'no_publicity', 'residuals'],
  },
}

// Template-specific optional clauses not in the shared set.
const EXTRA_OPTIONAL = {
  affiliates: { label: 'Binds affiliates', heading: 'AFFILIATES', text: 'The Receiving Party shall ensure that its affiliates, subsidiaries, officers, employees, and agents who receive Confidential Information are bound by confidentiality obligations no less protective than those set out in this Agreement.' },
  // Toggle only — the EXCLUSIONS body lives in coreSections and is included
  // when this clause is enabled (empty text here so it isn't appended twice).
  exclusions_note: { label: 'Standard exclusions', heading: 'EXCLUSIONS', text: '' },
}

export const clauseDef = (key) => OPTIONAL[key] || EXTRA_OPTIONAL[key] || null

// Build the full document body from field values and the set of enabled
// optional clause keys.
export function buildNdaBody(templateKey, form, enabled = {}, labelName) {
  const t = NDA_TEMPLATES[templateKey] || NDA_TEMPLATES.standard
  const intro = partyLine(t.key, form)

  const sections = []
  // Core (Confidential Information + Obligations always; Exclusions optional).
  for (const s of coreSections(form)) {
    if (s.heading === 'EXCLUSIONS' && !enabled.exclusions_note) continue
    sections.push(s)
  }
  // Enabled optional clauses (excluding the ones handled inline).
  for (const key of (t.optional || [])) {
    if (key === 'exclusions_note') continue
    if (!enabled[key]) continue
    const c = clauseDef(key)
    if (c && c.text) sections.push({ heading: c.heading, text: c.text })
  }
  // Closing mandatory sections.
  for (const s of closingSections(form)) sections.push(s)

  const numbered = sections.map((s, i) => `${i + 1}. ${s.heading}\n${s.text}`)
  const sig = val(form.signatory_name, '____________')
  const title = form.signatory_title ? `, ${form.signatory_title.trim()}` : ''
  const closing = `IN WITNESS WHEREOF, the parties have executed this Agreement as of the Effective Date.\n\nFor ${val(form.disclosing_party, labelName || 'the Disclosing Party')}:\n\n_________________________\n${sig}${title}\n\nFor the Receiving Party:\n\n_________________________\nName / Title`

  return [intro, ...numbered, closing].join('\n\n')
}

// Headings that must remain present in the (possibly edited) body.
export function mandatoryHeadings() {
  return ['CONFIDENTIAL INFORMATION', 'OBLIGATIONS OF RECEIVING PARTY', 'TERM', 'GOVERNING LAW']
}
