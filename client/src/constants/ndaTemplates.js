// NDA template registry for the /create-nda builder.
//
// A template declares a field set, a set of optional (toggleable) clauses, a
// list of mandatory section markers, a body builder, and (optionally) its own
// signature-block renderer. The builder page is generic over all of that, so
// adding a template is a matter of adding an entry to NDA_TEMPLATES.
//
// Two families live here:
//   • The three original short generic templates (standard / mutual /
//     corporate). They predate this file's rewrite and DOCUMENTS HAVE BEEN
//     GENERATED FROM THEM — the keys and clause keys must never change.
//   • `full` and `investment` — the two full-length agreements ported from the
//     reference app. `full` is a complete 15-section mutual-confidentiality
//     NDA; `investment` is the corporate-counterparty variant used when the
//     other side is evaluating an investment or transaction. Their text is
//     real legal wording and is reproduced verbatim; only party names, the
//     effective date and the signatory line are substituted.
//
// Mandatory section markers are validated against the (possibly hand-edited)
// body so a user can see when a clause has been deleted from a saved document.

// ── Shared helpers ────────────────────────────────────────────────────────

// Roman numerals for section headers. Sections are renumbered sequentially
// based on which optional sections are included, so headers always run
// I, II, III… without gaps when something is omitted.
export const ROMAN = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII',
  'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI',
]

// Parse YYYY-MM-DD as a LOCAL date so a timezone can't shift it a day, and
// format it as an en-US long date. Locked to en-US on purpose: the same saved
// form must produce the same document text on every machine — a browser-locale
// format would make the legal text machine-dependent.
export function formatEffectiveDate(s) {
  if (!s) return ''
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return String(s)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Escape a string for use inside a RegExp — used by the dirty-body diff to
// swap old field values out of hand-edited body text.
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Heading detection for the editable body. Returns:
//   2 — h1: centered document title (larger, centered in the PDF)
//   1 — h2: bold section / subsection header
//   0 — body paragraph
// Heuristics are biased toward false-negatives: a paragraph that fails the
// test renders as body text, which is safe. The opposite would bold something
// the user wrote as a sentence. Preview + PDF + docx all run this same pass.
export function getHeadingLevel(rawText) {
  const text = (rawText || '').trim()
  if (!text) return 0
  // h1 — short, no period, all-uppercase title (e.g. NON-DISCLOSURE AGREEMENT).
  if (text.length <= 80 && /^[A-Z][A-Z0-9 .,&\-/']{4,}$/.test(text) && !text.includes('.')) return 2
  // h2 — Roman numeral (I. / XIV.), single-letter subsection (A. / B.), or an
  // Arabic number (1. / 12.) followed by a short title. The Arabic branch is
  // what keeps the generic templates' `1. CONFIDENTIAL INFORMATION` headings
  // bold. The length + dot-count guards keep a long body paragraph that
  // happens to start with "I." from matching.
  const m = /^([IVXLCDM]{1,5}|[A-Z]|\d{1,2})\.\s+\S/.exec(text)
  if (m && text.length < 220 && (text.match(/\./g) || []).length <= 3) return 1
  return 0
}

// Split a body string into rendered paragraphs.
export const bodyParagraphs = (body) => (body || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

// The generic templates used to append an inline "IN WITNESS WHEREOF…" closing
// to the body because there was no separate signature block. There is one now
// (renderSignatureFor), so a saved body that still carries the legacy closing
// would render it twice. Strip it at RENDER time only — the stored body is
// never rewritten, so nothing is lost if this is ever revisited.
export function stripLegacyClosing(body) {
  const paras = bodyParagraphs(body)
  const i = paras.findIndex(p => /^IN WITNESS WHEREOF\b/i.test(p))
  return (i === -1 ? paras : paras.slice(0, i)).join('\n\n')
}

const val = (v, ph = '____________') => (v && String(v).trim()) ? String(v).trim() : ph

// Signature block renderer — returns a structured payload (party line + lines)
// that the on-screen preview, the PDF path and the docx path all consume.
//
// The recipient side inspects two optional extras:
//   recipient_signatory_name  — the individual signing for the recipient
//     entity. Falls back to the recipient party so a template without a
//     corporate signer still reads naturally.
//   recipient_signatory_title — omitted from the block when blank, so an
//     individual recipient doesn't get an empty "Title:" line.
export function defaultRenderSignature(form) {
  const ownerName = form.owner_name || form.disclosing_party || ''
  const recipientName = form.recipient_name || form.recipient_company || form.receiving_party || ''
  const recipientSignName = form.recipient_signatory_name || form.recipient_signatory || ''
  const recipientSignTitle = form.recipient_signatory_title || ''
  return {
    owner: {
      party: `OWNER: ${ownerName}`,
      lines: [
        'By: ____________________________',
        `Name: ${form.signatory_name || ''}`,
        `Title: ${form.signatory_title || ''}`,
        'Date: ____________________________',
      ],
    },
    recipient: {
      party: `RECIPIENT: ${recipientName}`,
      lines: [
        'By: ____________________________',
        `Name: ${recipientSignName || recipientName}`,
        ...(recipientSignTitle ? [`Title: ${recipientSignTitle}`] : []),
        'Date: ____________________________',
      ],
    },
  }
}

// Mutual agreements have no "owner"/"recipient" — both sides are Parties.
function mutualRenderSignature(form) {
  const base = defaultRenderSignature(form)
  return {
    owner: { ...base.owner, party: `FIRST PARTY: ${form.disclosing_party || ''}` },
    recipient: { ...base.recipient, party: `SECOND PARTY: ${form.receiving_party || ''}` },
  }
}

export function renderSignatureFor(template, form) {
  const t = typeof template === 'string' ? NDA_TEMPLATES[template] : template
  return (t && typeof t.renderSignature === 'function')
    ? t.renderSignature(form || {})
    : defaultRenderSignature(form || {})
}

// ── Shared field descriptors ──────────────────────────────────────────────

// The base field set the two full-length agreements share. `half` drives the
// two-up grid layout on the form.
const BASE_FIELDS = [
  { key: 'effective_date', label: 'Effective date', type: 'date', required: true, half: true },
  { key: 'owner_name', label: 'Owner name', required: true, half: true },
  { key: 'owner_address', label: 'Owner address', placeholder: 'Street, city, state, zip' },
  { key: 'recipient_name', label: 'Recipient name', required: true, half: true },
  { key: 'recipient_address', label: 'Recipient address', placeholder: 'Street, city, state, zip', half: true },
  { key: 'disclosed_to', label: 'Disclosed to (if not the recipient)', description: 'Leave blank to name the Recipient in the disclosure sentence.' },
  { key: 'signatory_name', label: 'Your signatory', half: true },
  { key: 'signatory_title', label: 'Signatory title', half: true },
]

// Field keys that appear directly in the body text and therefore participate
// in the dirty-body auto-sync (find old value → replace with new). The
// effective date is handled separately because it is date-formatted first.
export const BASE_BODY_FIELDS = [
  'owner_name', 'owner_address',
  'recipient_name', 'recipient_address', 'disclosed_to',
  'signatory_name', 'signatory_title',
]

const GENERIC_BODY_FIELDS = [
  'disclosing_party', 'receiving_party', 'recipient_company', 'recipient_signatory',
  'purpose', 'term_years', 'governing_law', 'signatory_name', 'signatory_title',
]

// ── Full 15-section agreement (`full`) ────────────────────────────────────

function buildFullBody(form, enabled) {
  const owner = form.owner_name || 'OWNER'
  const ownerAddr = form.owner_address || ''
  const recipient = form.recipient_name || 'RECIPIENT'
  const recipientAddr = form.recipient_address || ''
  const disclosedTo = form.disclosed_to || recipient
  const effective = formatEffectiveDate(form.effective_date) || '____________'
  const signatoryName = form.signatory_name || '___name____'
  const signatoryTitle = form.signatory_title || '__position___'

  const preamble = [
    'NON-DISCLOSURE AGREEMENT',
    `This Non-disclosure Agreement (this "Agreement") is made effective as of ${effective} (the "Effective Date"), by and between ${owner} (the "Owner"), of ${ownerAddr} and ${recipient} (the "Recipient"), located at ${recipientAddr}.`,
    `Information will be disclosed to ${disclosedTo} to determine whether ${disclosedTo} could assist ${owner} with the development of artists, marketing plans, business development and overall company strategy.`,
    'The Owner has requested and the Recipient agrees that the Recipient will protect the confidential material and information which may be disclosed between the Owner and the Recipient. Therefore, the parties agree as follows:',
  ]

  // Numbered sections. `optional` maps to a toggle key that gates inclusion.
  // The Roman numeral is assigned at render time so omitting an optional
  // section never leaves a gap in the sequence.
  const sections = [
    { title: 'CONFIDENTIAL INFORMATION.', paragraphs: [
      'The term "Confidential Information" means any information or material which is proprietary to the Owner, whether or not owned or developed by the Owner, which is not generally known other than by the Owner, and which the Recipient may obtain through any direct or indirect contact with the Owner. Regardless of whether specifically identified as confidential or proprietary, Confidential Information shall include any information provided by the Owner concerning the business, technology and information of the Owner and any third party with which the Owner deals, including, without limitation, business records and plans, trade secrets, technical data, product ideas, contracts, financial information, pricing structure, discounts, computer programs and listings, source code and/or object code, copyrights and intellectual property, inventions, sales leads, strategic alliances, partners, and customer and client lists. The nature of the information and the manner of disclosure are such that a reasonable person would understand it to be confidential.',
      'A. "Confidential Information" does not include:',
      '- matters of public knowledge that result from disclosure by the Owner;\n- information rightfully received by the Recipient from a third party without a duty of confidentiality;\n- information independently developed by the Recipient;\n- information disclosed by operation of law;\n- information disclosed by the Recipient with the prior written consent of the Owner; including bank statements, invoices, and any financial documents.\n- and any other information that both parties agree in writing is not confidential.',
    ] },
    { title: 'PROTECTION OF CONFIDENTIAL INFORMATION.', paragraphs: [
      'The Recipient understands and acknowledges that the Confidential Information has been developed or obtained by the Owner by the investment of significant time, effort and expense, and that the Confidential Information is a valuable, special and unique asset of the Owner which provides the Owner with a significant competitive advantage, and needs to be protected from improper disclosure. In consideration for the receipt by the Recipient of the Confidential Information, the Recipient agrees as follows:',
      'A. No Disclosure.',
      'The Recipient will hold the Confidential Information in confidence and will not disclose the Confidential Information to any person or entity without the prior written consent of the Owner.',
      'B. No Copying/Modifying.',
      'The Recipient will not copy or modify any Confidential Information without the prior written consent of the Owner.',
      'C. Unauthorized Use.',
      'The Recipient shall promptly advise the Owner if the Recipient becomes aware of any possible unauthorized disclosure or use of the Confidential Information.',
      'D. Application to Employees.',
      'The Recipient shall not disclose any Confidential Information to any employees of the Recipient, except those employees who are required to have the Confidential Information in order to perform their job duties in connection with the limited purposes of this Agreement. Each permitted employee to whom Confidential Information is disclosed shall sign a non-disclosure agreement substantially the same as this Agreement at the request of the Owner.',
    ] },
    { title: 'UNAUTHORIZED DISCLOSURE OF INFORMATION - INJUNCTION.', paragraphs: [
      'If it appears that the Recipient has disclosed (or has threatened to disclose) Confidential Information in violation of this Agreement, the Owner shall be entitled to an injunction to restrain the Recipient from disclosing the Confidential Information in whole or in part. The Owner shall not be prohibited by this provision from pursuing other remedies, including a claim for losses and damages.',
    ] },
    { title: 'NON-CIRCUMVENTION.', optional: 'include_non_circumvention', paragraphs: [
      'For a period of One (1) years after the end of the term of this Agreement, the Recipient will not attempt to do business with, or otherwise solicit any business contacts found or otherwise referred by Owner to Recipient for the purpose of circumventing, the result of which shall be to prevent the Owner from realizing or recognizing a profit, fees, or otherwise, without the specific written approval of the Owner. If such circumvention shall occur the Owner shall be entitled to any commissions due pursuant to this Agreement or relating to such transaction.',
    ] },
    { title: 'NON-SOLICITATION.', optional: 'include_non_solicitation', paragraphs: [
      'For a period of two (2) years after the expiration or termination of this Agreement, the Recipient shall not, directly or indirectly:',
      'A. Non-Solicitation of Employees.',
      'Solicit, recruit, hire, or attempt to solicit or hire any employee, contractor, or consultant of the Owner who was introduced to or became known to the Recipient in connection with this Agreement, without the prior written consent of the Owner.',
      'B. Non-Solicitation of Clients and Business Relationships.',
      'Solicit, contact, or attempt to do business with any client, customer, vendor, partner, or other business contact of the Owner that was introduced to or became known to the Recipient through or in connection with this Agreement, for the purpose of providing services or products competitive with or similar to those offered by the Owner.',
      'C. Non-Solicitation of Artists and Talent.',
      'Solicit, recruit, sign, or attempt to solicit any artist, performer, or talent managed, represented, or developed by the Owner that was introduced to or became known to the Recipient in connection with this Agreement, without the prior written consent of the Owner.',
      'D. Remedies.',
      'The Recipient acknowledges that any breach or threatened breach of this Section would cause irreparable harm to the Owner for which monetary damages would be an inadequate remedy, and the Owner shall be entitled to seek injunctive relief in addition to any other remedies available at law or in equity.',
    ] },
    { title: 'RETURN OF CONFIDENTIAL INFORMATION.', paragraphs: [
      'Upon the written request of the Owner, the Recipient shall return to the Owner all written materials containing the Confidential Information. The Recipient shall also deliver to the Owner written statements signed by the Recipient certifying that all materials have been returned within five (5) days of receipt of the request.',
    ] },
    { title: 'RELATIONSHIP OF PARTIES.', paragraphs: [
      'Neither party has an obligation under this Agreement to purchase any service or item from the other party, or commercially offer any products using or incorporating the Confidential Information. This Agreement does not create any agency, partnership, or joint venture.',
    ] },
    { title: 'NO WARRANTY.', paragraphs: [
      'The Recipient acknowledges and agrees that the Confidential Information is provided on an "AS IS" basis. THE OWNER MAKES NO WARRANTIES, EXPRESS OR IMPLIED, WITH RESPECT TO THE CONFIDENTIAL INFORMATION AND HEREBY EXPRESSLY DISCLAIMS ANY AND ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. IN NO EVENT SHALL THE OWNER BE LIABLE FOR ANY DIRECT, INDIRECT, SPECIAL, OR CONSEQUENTIAL DAMAGES IN CONNECTION WITH OR ARISING OUT OF THE PERFORMANCE OR USE OF ANY PORTION OF THE CONFIDENTIAL INFORMATION. The Owner does not represent or warrant that any product or business plans disclosed to the Recipient will be marketed or carried out as disclosed, or at all. Any actions taken by the Recipient in response to the disclosure of the Confidential Information shall be solely at the risk of the Recipient.',
    ] },
    { title: 'LIMITED LICENSE TO USE.', paragraphs: [
      'The Recipient shall not acquire any intellectual property rights under this Agreement except the limited right to use as set forth above. The Recipient acknowledges that, as between the Owner and the Recipient, the Confidential Information and all related copyrights and other intellectual property rights, are (and at all times will be) the property of the Owner, even if suggestions, comments, and/or ideas made by the Recipient are incorporated into the Confidential Information or related materials during the period of this Agreement.',
    ] },
    { title: 'INDEMNITY.', paragraphs: [
      'Each party agrees to defend, indemnify, and hold harmless the other party and its officers, directors, agents, affiliates, distributors, representatives, and employees from any and all third party claims, demands, liabilities, costs and expenses, including reasonable attorney’s fees, costs and expenses resulting from the indemnifying party’s material breach of any duty, representation, or warranty under this Agreement.',
    ] },
    { title: 'ATTORNEY’S FEES.', paragraphs: [
      'In any legal action between the parties concerning this Agreement, the prevailing party shall be entitled to recover reasonable attorney’s fees and costs.',
    ] },
    { title: 'TERM.', paragraphs: [
      'The obligations of this Agreement shall survive 2 Years from the Effective Date or until the Owner sends the Recipient written notice releasing the Recipient from this Agreement. After that, the Recipient must continue to protect the Confidential Information that was received during the term of this Agreement from unauthorized use or disclosure for an additional 2 years.',
    ] },
    { title: 'GENERAL PROVISIONS.', paragraphs: [
      'This Agreement sets forth the entire understanding of the parties regarding confidentiality. Any amendments must be in writing and signed by both parties. This Agreement shall be construed under the laws of the State of California. This Agreement shall not be assignable by either party. Neither party may delegate its duties under this Agreement without the prior written consent of the other party. The confidentiality provisions of this Agreement shall remain in full force and effect at all times in accordance with the term of this Agreement. If any provision of this Agreement is held to be invalid, illegal or unenforceable, the remaining portions of this Agreement shall remain in full force and effect and construed so as to best effectuate the original intent and purpose of this Agreement.',
    ] },
    { title: 'WHISTLEBLOWER PROTECTION.', paragraphs: [
      'This Agreement is in compliance with the Defend Trade Secrets Act and provides civil or criminal immunity to any individual for the disclosure of trade secrets: (i) made in confidence to a federal, state, or local government official, or to an attorney when the disclosure is to report suspected violations of the law; or (ii) in a complaint or other document filed in a lawsuit if made under seal.',
    ] },
    { title: 'SIGNATORIES.', paragraphs: [
      `This Agreement shall be executed by ${signatoryName}, ${signatoryTitle}, on behalf of ${owner} and ${recipient} and delivered in the manner prescribed by law as of the date first written above.`,
    ] },
  ]

  const out = [...preamble]
  let i = 0
  for (const s of sections) {
    // `=== false` (not `!enabled[k]`) so a document whose toggle map predates
    // a clause still renders that clause — matches the historical template.
    if (s.optional && enabled[s.optional] === false) continue
    out.push(`${ROMAN[i]}. ${s.title}`)
    out.push(...s.paragraphs)
    i++
  }
  return out.join('\n\n')
}

// ── Investment / corporate-counterparty agreement (`investment`) ──────────

function buildInvestmentBody(form) {
  const owner = form.owner_name || 'OWNER'
  const ownerAddr = form.owner_address || ''
  const recipient = form.recipient_name || 'RECIPIENT'
  const recipientAddr = form.recipient_address || ''
  const effective = formatEffectiveDate(form.effective_date) || '____________'
  const signatoryName = form.signatory_name || '___name____'
  const signatoryTitle = form.signatory_title || '__position___'

  const preamble = [
    'NON-DISCLOSURE AGREEMENT',
    `This Non-disclosure Agreement (this "Agreement") is made effective as of ${effective} (the "Effective Date"), by and between ${owner} (the "Owner"), of ${ownerAddr} and ${recipient} (the "Recipient"), located at ${recipientAddr}.`,
    'Certain Confidenital Information (as defined below) may be disclosed to the Recipient so that the Recipient may evaluate, negotiate or consummate a potential transaction with the Owner (the "Purpose").',
    'The Owner has requested and the Recipient agrees that the Recipient will protect the Confidential Information which may be disclosed between the Owner and the Recipient. Therefore, the parties agree as follows:',
  ]

  // This template uses EXPLICIT Roman numerals throughout so the two
  // "[intentionally omitted.]" placeholders keep their historical positions —
  // no auto-renumbering. Sections IX and XII were struck from the original
  // agreement; the placeholders preserve the numbering everything else
  // cross-references (see the Term section's survival list).
  const sections = [
    { roman: 'I', title: 'CONFIDENTIAL INFORMATION.', paragraphs: [
      'The term "Confidential Information" means any information or material which is proprietary to the Owner, whether or not owned or developed by the Owner, which is not generally known other than by the Owner, and which the Recipient may obtain through any direct contact with the Owner. Regardless of whether specifically identified as confidential or proprietary, Confidential Information shall include any information provided by the Owner concerning the business, technology and information of the Owner and any third party with which the Owner deals, including, without limitation, business records and plans, trade secrets, technical data, product ideas, contracts, financial information, pricing structure, discounts, computer programs and listings, source code and/or object code, copyrights and intellectual property, inventions, sales leads, strategic alliances, partners, and customer and client lists. The nature of the information and the manner of disclosure are such that a reasonable person would understand it to be confidential.',
      'A. "Confidential Information" does not include:',
      '- matters of public knowledge;\n- information received by the Recipient from a third party not known to owe a duty of confidentiality to the Owner;\n- information independently developed by the Recipient;\n- information disclosed by operation of law;\n- information disclosed by the Recipient with the prior written consent of the Owner; including bank statements, invoices, and any financial documents.\n- and any other information that both parties agree in writing is not confidential.',
    ] },
    { roman: 'II', title: 'PROTECTION OF CONFIDENTIAL INFORMATION.', paragraphs: [
      'The Recipient understands and acknowledges that the Confidential Information has been developed or obtained by the Owner by the investment of significant time, effort and expense, and that the Confidential Information is a valuable, special and unique asset of the Owner which provides the Owner with a significant competitive advantage, and needs to be protected from improper disclosure. In consideration for the receipt by the Recipient of the Confidential Information, the Recipient agrees as follows:',
      'A. No Disclosure.',
      'Except as permitted under this Agreement, the Recipient will hold the Confidential Information in confidence and will not disclose the Confidential Information to any person or entity without the prior written consent of the Owner.',
      'B. No Copying/Modifying.',
      'The Recipient will not copy or modify any Confidential Information without the prior written consent of the Owner.',
      'C. Unauthorized Use.',
      'The Recipient shall promptly advise the Owner if the Recipient becomes aware of any possible unauthorized disclosure or use of the Confidential Information by the Recipient or its Personnel (as defined below).',
      'D. Application to Personnel.',
      'The Recipient shall not disclose any Confidential Information to any third party, except its directors, officers, managers, employees, contractors, agents, legal and financial advisers, lenders, members, and affiliates (collectively, "Personnel") who are required to have the Confidential Information in order to evaluate, negotiate or consummate the Purpose. Each permitted Personnel to whom Confidential Information is disclosed shall have obligations of confidentiality to the Recipient consistent with those contained in this Agreement.',
      'E. Disclosure to Government Entities.',
      'The Recipient and its Personnel may disclose Confidential Information as required to comply with orders of governmental entities that have jurisdiction over it or as otherwise required by law or legal process. If the Recipient is required to disclose Confidential Information as provided in this Section II(E), the Recipient will, to the extent not prohibited by law, provide the Owner with prompt written notice of such requirement and will reasonably cooperate with the Owner (at the Owner\'s sole cost and expense) to protect against or limit the scope of such disclosure. Notwithstanding anything contained in this Agreement to the contrary, the Recipient will not be required to provide the Owner with any such advance notice, or provide the Owner with any opportunity to contest disclosure of any Confidential Information, if such disclosure is in connection with a supervisory examination or audit by, or a blanket request or inquiry from, a regulatory or governmental entity or a securities exchange having jurisdiction over the Recipient or its Personnel, so long as such examination, audit, request or inquiry does not specifically target or relate specifically to the Owner.',
    ] },
    { roman: 'III', title: 'UNAUTHORIZED DISCLOSURE OF INFORMATION - INJUNCTION.', paragraphs: [
      'If it appears that the Recipient has disclosed Confidential Information in breach of this Agreement, the Owner shall be entitled to seek an injunction to restrain the Recipient from disclosing the Confidential Information in whole or in part. The Owner shall not be prohibited by this provision from pursuing other remedies, including a claim for losses and damages.',
    ] },
    { roman: 'IV', title: 'RETURN OF CONFIDENTIAL INFORMATION.', paragraphs: [
      'Upon the written request of the Owner, the Recipient shall promptly return or destroy to the Owner all written materials containing the Confidential Information; provided, however, that the Recipient and its Personnel may retain copies of the Confidential Information to comply with applicable law or regulation or internal policies or as part of automatic electronic archiving and back-up procedures, provided further that such Confidential Information is kept confidential as provided in this Agreement. Upon further written request, the Recipient shall also deliver to the Owner written statements signed by the Recipient certifying that all materials have been returned or destroyed within 10 business days of receipt of the request.',
    ] },
    { roman: 'V', title: 'RELATIONSHIP OF PARTIES.', paragraphs: [
      'Neither party has an obligation under this Agreement to purchase any service or item from the other party, or commercially offer any products using or incorporating the Confidential Information. This Agreement does not create any agency, partnership, or joint venture. Neither party will be under any obligation to enter into any further agreements with the other party of any nature whatsoever as a result of this Agreement. Any party may terminate the evaluation of Confidential Information and any discussions with respect to the Purpose at any time for any reason or no reason. The Recipient will have the right to refuse to accept any Confidential Information under this Agreement.',
    ] },
    { roman: 'VI', title: 'NO WARRANTY.', paragraphs: [
      'The Recipient acknowledges and agrees that the Confidential Information is provided on an "AS IS" basis. EXCEPT AS MAY BE PROVIDED FOR WITHIN A DEFINITIVE AGREEMENT WITH RESPECT TO THE PURPOSE, (1) THE OWNER MAKES NO WARRANTIES, EXPRESS OR IMPLIED, WITH RESPECT TO THE CONFIDENTIAL INFORMATION AND HEREBY EXPRESSLY DISCLAIMS ANY AND ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE; AND (2) IN NO EVENT SHALL THE OWNER BE LIABLE FOR ANY DIRECT, INDIRECT, SPECIAL, OR CONSEQUENTIAL DAMAGES IN CONNECTION WITH OR ARISING OUT OF THE PERFORMANCE OR USE OF ANY PORTION OF THE CONFIDENTIAL INFORMATION.',
    ] },
    { roman: 'VII', title: 'LIMITED LICENSE TO USE.', paragraphs: [
      'The Recipient shall not acquire any intellectual property rights under this Agreement except the limited right to use as set forth above. The Recipient acknowledges that, as between the Owner and the Recipient, the Confidential Information and all related copyrights and other intellectual property rights, are (and at all times will be) the property of the Owner, even if suggestions, comments, and/or ideas made by the Recipient are incorporated into the Confidential Information or related materials during the period of this Agreement.',
    ] },
    { roman: 'VIII', title: 'OTHER BUSINESSES.', paragraphs: [
      'The Owner acknowledges that the Recipient is engaged in businesses that are similar to and competitive with the businesses of the Owner. Nothing in this Agreement shall limit or restrict in any way the Recipient from engaging in such businesses and competing with the Owner from using information and materials that are not Confidential Information in connection with its businesses, even if such information is similar to or duplicative of the Confidential Information. For clarity, nothing shall prevent the Recipient from developing or commercializing new business strategies, as long as such activities do not utilize any Confidential Information in breach of this Agreement. The Owner agrees that its Confidential Information will inevitably enhance and increase the knowledge of the Recipient and its Personnel that actually receive Confidential Information in a way that cannot be forgotten or separated from such persons\' overall knowledge base and, accordingly, neither the Recipient nor its Personnel will be (or be deemed to be) in breach of this Agreement by reason of remembering, retaining and/or using such enhanced or increased knowledge in such persons\' respective businesses.',
    ] },
    { roman: 'IX', title: '[intentionally omitted.]', paragraphs: [] },
    { roman: 'X', title: 'TERM.', paragraphs: [
      'The obligations of this Agreement shall survive until the earlier of (1) one year from the Effective Date or (2) until the Owner sends the Recipient written notice releasing the Recipient from this Agreement; provided, however, that Sections IV, V, VII through XI shall survive indefinitely.',
    ] },
    { roman: 'XI', title: 'GENERAL PROVISIONS.', paragraphs: [
      'This Agreement sets forth the entire understanding of the parties regarding confidentiality. Any amendments must be in writing and signed by both parties. This Agreement shall be construed under the laws of the State of California. This Agreement shall not be assignable by either party. Neither party may delegate its duties under this Agreement without the prior written consent of the other party. The confidentiality provisions of this Agreement shall remain in full force and effect at all times in accordance with the term of this Agreement. If any provision of this Agreement is held to be invalid, illegal or unenforceable, the remaining portions of this Agreement shall remain in full force and effect and construed so as to best effectuate the original intent and purpose of this Agreement.',
    ] },
    { roman: 'XII', title: '[intentionally omitted.]', paragraphs: [] },
    { roman: 'XIII', title: 'SIGNATORIES.', paragraphs: [
      `This Agreement shall be executed by ${signatoryName}, ${signatoryTitle}, on behalf of the Owner and the Recipient and delivered in the manner prescribed by law as of the date first written above.`,
    ] },
  ]

  const out = [...preamble]
  for (const s of sections) {
    out.push(`${s.roman}. ${s.title}`)
    out.push(...s.paragraphs)
  }
  return out.join('\n\n')
}

// ── Short generic templates (standard / mutual / corporate) ───────────────
// Kept exactly as generated before this rewrite so existing saved documents
// keep matching their template. Clause keys are part of the stored payload.

const GENERIC_CLAUSES = {
  non_solicitation: {
    label: 'Non-solicitation',
    description: '1-year restriction on soliciting the other side’s employees.',
    heading: 'NON-SOLICITATION',
    marker: /NON-SOLICITATION/,
    text: 'For a period of one (1) year following disclosure, the Receiving Party shall not directly solicit for employment any employee of the Disclosing Party first identified through the Confidential Information.',
  },
  return_materials: {
    label: 'Return of materials',
    description: 'Return or destroy all materials on written request, with certification.',
    heading: 'RETURN OF MATERIALS',
    marker: /RETURN OF MATERIALS/,
    text: 'Upon the Disclosing Party’s written request, the Receiving Party shall promptly return or destroy all tangible materials embodying Confidential Information, together with all copies, and certify such destruction in writing.',
  },
  no_publicity: {
    label: 'No publicity',
    description: 'Neither side may announce the discussions without consent.',
    heading: 'NO PUBLICITY',
    marker: /NO PUBLICITY/,
    text: 'Neither party shall issue any press release or public statement regarding this Agreement or the discussions between the parties without the prior written consent of the other party.',
  },
  injunctive_relief: {
    label: 'Injunctive relief',
    description: 'Entitles the disclosing side to seek an injunction on breach.',
    heading: 'INJUNCTIVE RELIEF',
    marker: /INJUNCTIVE RELIEF/,
    text: 'The Receiving Party acknowledges that any breach of this Agreement may cause irreparable harm for which monetary damages would be inadequate, and that the Disclosing Party shall be entitled to seek injunctive relief in addition to any other remedies available at law or in equity.',
  },
  residuals: {
    label: 'Residuals',
    description: 'Preserves unaided-memory general knowledge, skills and experience.',
    heading: 'RESIDUALS',
    marker: /RESIDUALS/,
    text: 'Nothing herein shall restrict either party from using general knowledge, skills, and experience retained in the unaided memory of its personnel, provided that no Confidential Information is intentionally memorized for the purpose of retaining or using it.',
  },
  affiliates: {
    label: 'Binds affiliates',
    description: 'Extends the obligations to affiliates, officers, employees and agents.',
    heading: 'AFFILIATES',
    marker: /AFFILIATES/,
    text: 'The Receiving Party shall ensure that its affiliates, subsidiaries, officers, employees, and agents who receive Confidential Information are bound by confidentiality obligations no less protective than those set out in this Agreement.',
  },
  // Toggle only — the EXCLUSIONS body lives in the core section list and is
  // included when this clause is enabled (empty text so it isn't appended
  // twice).
  exclusions_note: {
    label: 'Standard exclusions',
    description: 'Carves out public, pre-known, third-party and independently developed information.',
    heading: 'EXCLUSIONS',
    marker: /EXCLUSIONS/,
    text: '',
  },
}

const genericPartyLine = (key, form) => {
  const eff = formatEffectiveDate(form.effective_date) || '____________'
  const disc = val(form.disclosing_party, 'DISCLOSING PARTY')
  if (key === 'mutual') {
    const recv = val(form.receiving_party, 'SECOND PARTY')
    return `This Mutual Non-Disclosure Agreement (the “Agreement”) is entered into as of ${eff} by and between ${disc} and ${recv} (each a “Party” and together the “Parties”), who each intend to disclose certain confidential information to the other.`
  }
  if (key === 'corporate') {
    const co = val(form.recipient_company, 'RECIPIENT COMPANY')
    const sig = val(form.recipient_signatory, 'authorized signatory')
    return `This Non-Disclosure Agreement (the “Agreement”) is entered into as of ${eff} by and between ${disc} (the “Disclosing Party”) and ${co}, a corporation acting by its ${sig} (the “Receiving Party”).`
  }
  const recv = val(form.receiving_party, 'RECEIVING PARTY')
  return `This Non-Disclosure Agreement (the “Agreement”) is entered into as of ${eff} by and between ${disc} (the “Disclosing Party”) and ${recv} (the “Receiving Party”).`
}

const genericCore = (form) => ([
  { heading: 'CONFIDENTIAL INFORMATION', text: `“Confidential Information” means any non-public information disclosed by one party to the other, whether orally, in writing, or by inspection of tangible objects, including but not limited to unreleased recordings, business plans, financial data, marketing strategies, and the terms of the parties’ discussions concerning ${val(form.purpose, 'the proposed transaction')}.` },
  { heading: 'OBLIGATIONS OF RECEIVING PARTY', text: 'The Receiving Party shall (a) hold the Confidential Information in strict confidence, (b) not disclose it to any third party without prior written consent, and (c) use it solely for the Purpose. The Receiving Party shall protect the Confidential Information with at least the same degree of care it uses for its own confidential information, and in no event less than reasonable care.' },
  { heading: 'EXCLUSIONS', optional: 'exclusions_note', text: 'Confidential Information does not include information that (a) is or becomes public through no fault of the Receiving Party, (b) was known to the Receiving Party prior to disclosure, (c) is rightfully received from a third party without duty of confidentiality, or (d) is independently developed without use of the Confidential Information.' },
])

const genericClosing = (form) => ([
  { heading: 'TERM', text: `This Agreement shall remain in effect for ${val(form.term_years, 'two (2)')} year(s) from the Effective Date, and the obligations of confidentiality shall survive any termination for so long as the Confidential Information remains non-public.` },
  { heading: 'GOVERNING LAW', text: `This Agreement shall be governed by and construed in accordance with the laws of ${val(form.governing_law, 'the applicable jurisdiction')}, without regard to its conflict-of-laws principles.` },
])

function buildGenericBody(key, form, enabled) {
  const t = NDA_TEMPLATES[key]
  const sections = []
  for (const s of genericCore(form)) {
    if (s.optional && !enabled[s.optional]) continue
    sections.push(s)
  }
  for (const c of (t.optionalClauses || [])) {
    if (c.key === 'exclusions_note') continue
    if (!enabled[c.key]) continue
    if (c.text) sections.push({ heading: c.heading, text: c.text })
  }
  for (const s of genericClosing(form)) sections.push(s)
  // Heading and clause text are SEPARATE paragraphs. Joined with a single \n
  // they form one paragraph, and getHeadingLevel's length guard then classifies
  // the whole thing as body — so the heading loses its bold in the preview, the
  // PDF and the docx alike.
  const numbered = sections.flatMap((s, i) => [`${i + 1}. ${s.heading}`, s.text])
  // No inline "IN WITNESS WHEREOF" closing — the signature block is rendered
  // separately by every consumer (see renderSignatureFor / stripLegacyClosing).
  return [genericPartyLine(key, form), ...numbered].join('\n\n')
}

const GENERIC_MANDATORY = [
  { name: 'CONFIDENTIAL INFORMATION', test: /CONFIDENTIAL INFORMATION/ },
  { name: 'OBLIGATIONS OF RECEIVING PARTY', test: /OBLIGATIONS OF RECEIVING PARTY/ },
  { name: 'TERM', test: /\bTERM\b/ },
  { name: 'GOVERNING LAW', test: /GOVERNING LAW/ },
]

const genericFields = (extra = []) => ([
  { key: 'effective_date', label: 'Effective date', type: 'date', required: true, half: true },
  ...extra,
  { key: 'purpose', label: 'Purpose of disclosure' },
  { key: 'term_years', label: 'Term (years)', half: true },
  { key: 'governing_law', label: 'Governing law (state/country)', half: true },
  { key: 'signatory_name', label: 'Your signatory', half: true },
  { key: 'signatory_title', label: 'Signatory title', half: true },
])

const pickClauses = (...keys) => keys.map(k => ({ key: k, ...GENERIC_CLAUSES[k] }))

// ── Registry ──────────────────────────────────────────────────────────────

export const NDA_TEMPLATES = {
  full: {
    key: 'full',
    name: 'Full agreement (15 sections)',
    description: 'The complete mutual-confidentiality NDA: protection A–D, injunction, return + certification, no warranty, limited license, indemnity, term and DTSA whistleblower protection. Optional non-circumvention and non-solicitation clauses.',
    filenamePrefix: 'NDA',
    fields: BASE_FIELDS,
    optionalClauses: [
      { key: 'include_non_circumvention', label: 'Include Non-Circumvention', description: '1-year restriction on doing business with the Owner’s contacts.', marker: /NON-CIRCUMVENTION/ },
      { key: 'include_non_solicitation', label: 'Include Non-Solicitation', description: '2-year restriction on soliciting employees, clients, and artists.', marker: /NON-SOLICITATION/ },
    ],
    defaults: { include_non_circumvention: true, include_non_solicitation: true },
    mandatorySections: [
      { name: 'CONFIDENTIAL INFORMATION', test: /CONFIDENTIAL INFORMATION\./ },
      { name: 'PROTECTION OF CONFIDENTIAL INFORMATION', test: /PROTECTION OF CONFIDENTIAL INFORMATION/ },
      { name: 'RETURN OF CONFIDENTIAL INFORMATION', test: /RETURN OF CONFIDENTIAL INFORMATION/ },
      { name: 'TERM', test: /\bTERM\./ },
      { name: 'GENERAL PROVISIONS', test: /GENERAL PROVISIONS/ },
      { name: 'WHISTLEBLOWER PROTECTION', test: /WHISTLEBLOWER PROTECTION/ },
      { name: 'SIGNATORIES', test: /\bSIGNATORIES\./ },
    ],
    bodyFields: BASE_BODY_FIELDS,
    buildBody: buildFullBody,
  },
  investment: {
    key: 'investment',
    name: 'Investment / corporate counterparty',
    description: 'Confidentiality agreement for a corporate counterparty evaluating a potential investment or transaction. Adds the Purpose preamble, a Personnel definition, a government-disclosure carve-out, 10-business-day retention and an Other Businesses clause.',
    filenamePrefix: 'NDA',
    fields: [
      ...BASE_FIELDS.filter(f => f.key !== 'disclosed_to'),
      { key: 'recipient_signatory_name', label: 'Recipient signatory name', description: 'The individual signing on behalf of the recipient entity.', half: true },
      { key: 'recipient_signatory_title', label: 'Recipient signatory title', half: true },
    ],
    optionalClauses: [],
    defaults: {},
    mandatorySections: [
      { name: 'PROTECTION OF CONFIDENTIAL INFORMATION', test: /PROTECTION OF CONFIDENTIAL INFORMATION/ },
      { name: 'RETURN OF CONFIDENTIAL INFORMATION', test: /RETURN OF CONFIDENTIAL INFORMATION/ },
      { name: 'OTHER BUSINESSES', test: /OTHER BUSINESSES/ },
      { name: 'TERM', test: /\bTERM\./ },
      { name: 'GENERAL PROVISIONS', test: /GENERAL PROVISIONS/ },
      { name: 'SIGNATORIES', test: /\bSIGNATORIES\./ },
    ],
    bodyFields: BASE_BODY_FIELDS,
    buildBody: buildInvestmentBody,
  },
  standard: {
    key: 'standard',
    name: 'Short form (one-way)',
    description: 'A short one-way NDA for vendors, collaborators and freelancers — six clauses on a single page.',
    filenamePrefix: 'NDA',
    fields: genericFields([
      { key: 'disclosing_party', label: 'Disclosing party', required: true },
      { key: 'receiving_party', label: 'Receiving party', required: true },
    ]),
    optionalClauses: pickClauses('exclusions_note', 'return_materials', 'non_solicitation', 'injunctive_relief', 'no_publicity', 'residuals'),
    defaults: { exclusions_note: true, return_materials: true, injunctive_relief: true },
    mandatorySections: GENERIC_MANDATORY,
    bodyFields: GENERIC_BODY_FIELDS,
    buildBody: (form, enabled) => buildGenericBody('standard', form, enabled),
  },
  mutual: {
    key: 'mutual',
    name: 'Short form (mutual)',
    description: 'Both parties disclose and receive confidential information. Common for label-to-label or partnership talks.',
    filenamePrefix: 'NDA',
    fields: genericFields([
      { key: 'disclosing_party', label: 'First party', required: true },
      { key: 'receiving_party', label: 'Second party', required: true },
    ]),
    optionalClauses: pickClauses('return_materials', 'non_solicitation', 'injunctive_relief', 'no_publicity', 'residuals'),
    defaults: { return_materials: true, injunctive_relief: true },
    mandatorySections: GENERIC_MANDATORY,
    bodyFields: GENERIC_BODY_FIELDS,
    renderSignature: mutualRenderSignature,
    buildBody: (form, enabled) => buildGenericBody('mutual', form, enabled),
  },
  corporate: {
    key: 'corporate',
    name: 'Short form (corporate recipient)',
    description: 'Recipient is a company acting through an authorized signatory. Adds an entity block and binding-on-affiliates language.',
    filenamePrefix: 'NDA',
    fields: genericFields([
      { key: 'disclosing_party', label: 'Disclosing party', required: true },
      { key: 'recipient_company', label: 'Recipient company', required: true },
      { key: 'recipient_signatory', label: 'Recipient signatory / title' },
    ]),
    optionalClauses: pickClauses('affiliates', 'return_materials', 'non_solicitation', 'injunctive_relief', 'no_publicity', 'residuals'),
    defaults: { affiliates: true, return_materials: true, injunctive_relief: true },
    mandatorySections: GENERIC_MANDATORY,
    bodyFields: GENERIC_BODY_FIELDS,
    buildBody: (form, enabled) => buildGenericBody('corporate', form, enabled),
  },
}

// Ordered list — the FIRST entry is what an unknown/missing :template id falls
// back to, so the builder never lands on a blank state.
export const NDA_TEMPLATE_LIST = [
  NDA_TEMPLATES.full,
  NDA_TEMPLATES.investment,
  NDA_TEMPLATES.standard,
  NDA_TEMPLATES.mutual,
  NDA_TEMPLATES.corporate,
]

export function getTemplate(key) {
  return NDA_TEMPLATES[key] || NDA_TEMPLATE_LIST[0]
}

// Merge template defaults + blank values for every declared field into the
// initial form for a template.
export function blankFormFor(template, seed = {}) {
  const t = typeof template === 'string' ? getTemplate(template) : template
  const form = {}
  for (const f of (t.fields || [])) form[f.key] = seed[f.key] ?? ''
  return form
}

export function defaultEnabledFor(template) {
  const t = typeof template === 'string' ? getTemplate(template) : template
  return { ...(t.defaults || {}) }
}

export function clauseDef(templateKey, clauseKey) {
  const t = getTemplate(templateKey)
  return (t.optionalClauses || []).find(c => c.key === clauseKey) || null
}

// Sections the template considers mandatory that are NOT present in the given
// (possibly hand-edited) body. Non-blocking — the builder surfaces this as a
// warning with an inline reset, matching the reference app.
export function missingMandatorySections(templateKey, body) {
  if (!body) return []
  return (getTemplate(templateKey).mandatorySections || [])
    .filter(s => !s.test.test(body))
    .map(s => s.name)
}

// Re-derive the optional-clause toggles from a SAVED body. The body is what
// becomes the PDF, so it is the only honest signal of what a document actually
// contains: a stored toggle map lies about a clause the user deleted by hand.
// Falls back to the stored map (with `!== false` NULL semantics) when there is
// no body to read.
export function deriveEnabledFromBody(templateKey, body, stored = {}) {
  const t = getTemplate(templateKey)
  const out = {}
  for (const c of (t.optionalClauses || [])) {
    out[c.key] = (body && c.marker) ? c.marker.test(body) : (stored[c.key] !== false)
  }
  return out
}

export function buildNdaBody(templateKey, form, enabled = {}) {
  const t = getTemplate(templateKey)
  return t.buildBody(form || {}, enabled || {})
}
