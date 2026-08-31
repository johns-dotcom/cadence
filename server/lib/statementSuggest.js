// View-time category / income-type suggestions for open bank rows.
// Computed at GET-detail time, NEVER stored — a pattern fix retroactively
// applies to every statement. Nothing books without a person confirming.
//
// ORDERING IS LOAD-BEARING (each rule documented from real descriptors):
//  1. Uber Eats FIRST, so card-descriptor variants ("UBER *EATS",
//     "UBEREATS 800…") never fall through to Travel.
//  2. Travel's uber has an asterisk-tolerant negative lookahead on "eats".
//  4. The generic "<bank word> fee" regex covers "External transfer fee -
//     Next Day" phrasings while leaving vendor fees ("producer fee",
//     "mixing fee") unsuggested.
//  5. Bank Fees two-signal FALLBACK is a function entry, not a regex —
//     `fees?|charge` AND names a bank/processor. The array supports both
//     shapes: find(s => s.re ? s.re.test(hay) : s.test(hay)).

const CATEGORY_SUGGESTIONS = [
  { re: /uber\s*\*?\s*eats|ubereats/i, cat: 'Meals & Entertainment' },
  { re: /\buber\b(?!\s*\*?\s*eats)|\blyft\b|\btaxi\b|rideshare|\bparking\b|\bshell oil|\bchevron\b|\bexxon\b|\barco\b|gas station/i, cat: 'Travel' },
  { re: /\bairline|\bdelta air|\bunited air|american air|\bjetblue\b|\bsouthwest\b|\balaska air|\bhotel\b|marriott|hilton|\bhyatt\b|airbnb|\bamtrak\b|\bhertz\b|enterprise rent|\bavis\b/i, cat: 'Travel' },
  { re: /\b(wire|transfer|ach|atm|withdrawal|deposit|account|card|check|statement|analysis|annual|monthly|maintenance|service|servicing|processing|transaction|conversion|currency|bank|paypal|overdraft|late payment|stop payment|returned? item|nsf) fees?\b|service charge|overdraft|nsf\b|insufficient funds|foreign transaction|intl? transaction/i, cat: 'Bank Fees' },
  {
    // Two-signal fallback: a fee/charge word AND a bank/processor name.
    test: (hay) => /\bfees?\b|\bcharge\b/i.test(hay)
      && /(bank of america|wells fargo|chase|jpmorgan|citi|capital one|pnc|td bank|us bank|hsbc|paypal|venmo|stripe|square\b|wise\b|mercury)/i.test(hay),
    cat: 'Bank Fees',
  },
  { re: /doordash|grubhub|postmates|caviar\b|seamless\b|restaurant|\bcafe\b|\bcoffee\b|starbucks|chipotle|sweetgreen|\bdiner\b|\bpizz(a|eria)\b/i, cat: 'Meals & Entertainment' },
  { re: /\badobe\b|dropbox|\bslack\b|\bzoom\b|notion|figma|canva|apple\.com\/bill|\bopenai\b|anthropic|github|\baws\b|amazon web|vercel|railway\.app|splice|izotope|waves audio|native instruments|ableton|\bgoogle\s*(one|storage|workspace|gsuite)\b|microsoft 365|mailchimp|squarespace|godaddy|namecheap/i, cat: 'Software / Subscriptions' },
  { re: /\bfedex\b|ups store|\busps\b|\bdhl\b/i, cat: 'Services' },
  { re: /\bgusto\b|\badp\b|paychex|justworks|rippling|\bdeel\b|trinet|payroll|\bsalary\b/i, cat: 'Salary' },
];

function suggestCategory(payeeGuess, description) {
  const hay = `${payeeGuess || ''} ${description || ''}`;
  const hit = CATEGORY_SUGGESTIONS.find((s) => (s.re ? s.re.test(hay) : s.test(hay)));
  return hit ? hit.cat : null;
}

// Income-type suggestion for open credits. ORDER:
//   refund/reversal → Refund
//   drawdown / \badvance\b → Drawdown Fund — MUST precede the distributor
//     rule ("STEM ADVANCE" is a drawdown, not royalties); word boundary so
//     "Advanced Audio LLC" never matches
//   distributor names → Streaming / Distribution
function suggestIncomeType(payeeGuess, description) {
  const hay = `${payeeGuess || ''} ${description || ''}`;
  if (/refund|reversal of payment/i.test(hay)) return 'Refund';
  if (/drawdown|\badvance\b/i.test(hay)) return 'Drawdown Fund';
  if (/distrokid|tunecore|cd ?baby|believe\b|stem\b|too ?lost|symphonic|vydia|united masters|distribution/i.test(hay)) return 'Streaming / Distribution';
  return null;
}

module.exports = { CATEGORY_SUGGESTIONS, suggestCategory, suggestIncomeType };
