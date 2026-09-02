#!/usr/bin/env node
/*
 * sync-vendor-lab — generate `src/pages/VendorSubmitLab.jsx` from
 * `src/pages/VendorSubmit.jsx` by applying a small set of NAMED, ANCHORED
 * deltas.
 *
 * Usage:
 *   node scripts/sync-vendor-lab.mjs           # write the lab
 *   node scripts/sync-vendor-lab.mjs --check   # exit 1 if the lab is stale
 *
 * WHY A GENERATED COPY AND NOT A `sandbox` PROP ON THE LIVE FORM
 * -------------------------------------------------------------
 * The live form is a PUBLIC, unauthenticated, token-addressed page that creates
 * real ledger entries, uploads to R2 and spends AI calls. A prop puts every
 * sandbox experiment exactly one prop-check away from that route: one inverted
 * boolean, one default that flips, one `??` in the wrong place, and the public
 * form is running the lab's behaviour — or worse, the lab is running the public
 * form's. The copy exists so it can be broken. It is generated rather than
 * hand-forked so it cannot quietly drift a validation rule away from the form
 * it is supposed to mirror: the whole value of the lab is that a refusal in the
 * lab is the refusal a vendor gets.
 *
 * Rules this script enforces:
 *   1. Every delta's `find` anchor must match EXACTLY ONCE. Zero or two, and
 *      the script exits non-zero naming the delta, having written nothing —
 *      a half-applied lab is worse than a stale one.
 *   2. A post-condition on the OUTPUT: every `/vendor/${slug}/submit` call in
 *      the generated file must carry `?sandbox=1`, and there must be exactly
 *      one of them. The generated lab must be structurally incapable of
 *      writing, independent of anyone reading the deltas.
 *   3. `--check` is the CI/pre-push drift guard — run it next to
 *      `npm run build`.
 *
 * DO NOT hand-edit src/pages/VendorSubmitLab.jsx. Edit VendorSubmit.jsx (or a
 * delta here) and re-run this script. Lab-only chrome lives in
 * src/components/vendor/SandboxReport.jsx, which is hand-written — keeping
 * bespoke JSX out of the generated file keeps the anchor set small.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '../src/pages/VendorSubmit.jsx');
const OUT = path.join(HERE, '../src/pages/VendorSubmitLab.jsx');

const HEADER = `// GENERATED FILE — DO NOT EDIT.
//
// Produced from src/pages/VendorSubmit.jsx by client/scripts/sync-vendor-lab.mjs.
// Edit the live form (or a delta in that script) and re-run it:
//   node scripts/sync-vendor-lab.mjs
//   node scripts/sync-vendor-lab.mjs --check   # drift guard
//
// This is the internal Vendor Form Lab: a byte-for-byte copy of the public
// vendor form whose ONLY behavioural differences are that it authenticates,
// posts to ?sandbox=1 (a write-nothing dry run that still runs every server
// validation), keeps its draft under its own localStorage key, and reports
// what WOULD have been created instead of thanking a vendor.
//
// It is a copy rather than a prop on the live form on purpose: the live form is
// public and creates real ledger rows, and a prop would put every sandbox
// experiment one boolean away from that route. See the script header.
`;

const DELTAS = [
  {
    name: 'imports — auth-derived token + lab chrome, no route param',
    find: `import { useParams } from 'react-router-dom'\n`,
    replace: `import { useAuth } from '../context/AuthContext'\nimport { SandboxBanner, SandboxReport } from '../components/vendor/SandboxReport'\n`,
  },
  {
    name: 'component rename + token source',
    find: `// PUBLIC page — no auth. Reached at /submit/:token. Three-step wizard, branded
// per label. Draft autosaves to localStorage (files + sensitive payment numbers
// excluded) so a refresh doesn't lose typing.
export default function VendorSubmit() {
  const { slug } = useParams()`,
    replace: `// INTERNAL LAB — signed-in, admin-gated, rendered inside the app shell at
// /vendor-lab. Identical to the public form except that it submits to the
// write-nothing sandbox. The form token comes from the signed-in workspace
// rather than the URL, so an admin can never point the lab at another tenant.
export default function VendorSubmitLab() {
  const { label } = useAuth()
  const slug = label?.vendor_form_token`,
  },
  {
    name: 'draft key — the lab must not clobber a real draft for the same token',
    find: '  const draftKey = `vendorform:${slug}`',
    replace: '  const draftKey = `vendorform-lab:${slug}`',
  },
  {
    name: 'submit → sandbox dry run',
    find: '      const { data } = await api.post(`/vendor/${slug}/submit`, fd, { headers: { \'Content-Type\': \'multipart/form-data\' } })',
    replace: '      const { data } = await api.post(`/vendor/${slug}/submit?sandbox=1`, fd, { headers: { \'Content-Type\': \'multipart/form-data\' } })',
  },
  {
    name: 'success screen → sandbox report',
    find: `  if (done) return (
    <Center>
      <CheckCircle2 size={40} className="text-success mx-auto mb-4" />
      <h1 className="text-lg font-bold text-ink mb-2">{isReimb ? 'Reimbursement received' : 'Invoice received'}</h1>
      <p className="text-sm text-ink-muted mb-1.5">Thanks — {ctx.name} has your {isReimb ? 'reimbursement request' : 'invoice'} and will review it shortly.</p>
      {done.scheduled_payment_date && (
        <p className="text-sm text-ink-muted mb-4">Our standard terms are <span className="font-semibold text-ink">{done.payment_terms || 'Net 30'}</span> — payment on or around <span className="font-semibold text-ink">{dstr(done.scheduled_payment_date)}</span>.</p>
      )}
      <button onClick={submitAnother} className="btn-secondary mx-auto">Submit another invoice</button>
    </Center>
  )`,
    replace: `  if (done) return <SandboxReport result={done} onReset={submitAnother} />`,
  },
  {
    name: 'sandbox banner',
    find: `      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-5">`,
    replace: `      <div className="max-w-2xl mx-auto">
        <SandboxBanner slug={slug} />
        <div className="text-center mb-5">`,
  },
];

function generate(src) {
  let out = src;
  for (const d of DELTAS) {
    const hits = out.split(d.find).length - 1;
    if (hits !== 1) {
      throw new Error(
        `delta "${d.name}" matched its anchor ${hits} time(s), expected exactly 1.\n` +
        `The live form changed under it. Re-read VendorSubmit.jsx and fix the anchor in scripts/sync-vendor-lab.mjs.`
      );
    }
    out = out.replace(d.find, d.replace);
  }
  out = HEADER + out;

  // ── Post-conditions on the OUTPUT ────────────────────────────────────────
  // Independent of whether the deltas above read correctly: the generated file
  // must be unable to write.
  const submits = out.match(/`\/vendor\/\$\{slug\}\/submit[^`]*`/g) || [];
  if (submits.length !== 1) {
    throw new Error(`post-condition: expected exactly 1 submit call in the generated lab, found ${submits.length} (${submits.join(', ')})`);
  }
  if (!submits[0].includes('sandbox=1')) {
    throw new Error(`post-condition: the generated lab's submit call does not carry sandbox=1 — it would write real data (${submits[0]})`);
  }
  if (!/export default function VendorSubmitLab\(/.test(out)) {
    throw new Error('post-condition: the generated lab does not export VendorSubmitLab');
  }
  if (/function VendorSubmit\(/.test(out)) {
    throw new Error('post-condition: the generated lab still declares VendorSubmit — two components would claim the same name');
  }
  if (/useParams/.test(out)) {
    throw new Error('post-condition: the generated lab still reads a route param — its token must come from the signed-in workspace');
  }
  return out;
}

let generated;
try {
  generated = generate(fs.readFileSync(SRC, 'utf8'));
} catch (err) {
  console.error(`sync-vendor-lab: ${err.message}`);
  process.exit(1);
}

const check = process.argv.includes('--check');
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;

if (check) {
  if (current === generated) {
    console.log('sync-vendor-lab: VendorSubmitLab.jsx is up to date');
    process.exit(0);
  }
  console.error('sync-vendor-lab: VendorSubmitLab.jsx is STALE — run `node scripts/sync-vendor-lab.mjs` and commit the result.');
  process.exit(1);
}

if (current === generated) {
  console.log('sync-vendor-lab: no change');
} else {
  fs.writeFileSync(OUT, generated);
  console.log(`sync-vendor-lab: wrote ${path.relative(process.cwd(), OUT)} (${DELTAS.length} deltas applied)`);
}
