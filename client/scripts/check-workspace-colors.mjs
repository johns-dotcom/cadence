// Gate for the operator console's workspace-identity colours.
//
// Two things this catches that nothing else can:
//
//  1. The palette lives in TWO places — `--ws-1 … --ws-8` in tokens.css (what
//     the browser paints) and PALETTE in utils/workspaceColor.js (what the
//     similarity maths measures). Edit one and the console would measure
//     colours it is not showing. This asserts they are identical.
//  2. The slot ORDER is the colourblind-safety mechanism, and its guarantee is
//     about ADJACENT slots. This re-runs the two published gates on every
//     adjacent pair in both themes, so "re-run the validator" is enforced
//     rather than requested.
//
// Run: npm run check:ws-colors
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(path.join(ROOT, 'src/utils/workspaceColor.js'));

let failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) return;
  failed++;
  console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
};

// ── 1. tokens.css and the JS palette are the same eight colours ─────────────
const css = fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8');
const darkStart = css.indexOf('.dark {');
const slotsIn = (text) => {
  const found = [];
  for (const m of text.matchAll(/--ws-(\d):\s*(#[0-9a-fA-F]{6})/g)) found[Number(m[1]) - 1] = m[2].toLowerCase();
  return found;
};
const cssLight = slotsIn(css.slice(0, darkStart));
const cssDark = slotsIn(css.slice(darkStart));
for (const [mode, fromCss] of [['light', cssLight], ['dark', cssDark]]) {
  const fromJs = M.PALETTE[mode].map(c => c.toLowerCase());
  ok(`tokens.css defines all 8 ${mode} slots`, fromCss.filter(Boolean).length === 8, `found ${fromCss.filter(Boolean).length}`);
  ok(`${mode} palette matches tokens.css exactly`, fromCss.join() === fromJs.join(),
    `\n         css: ${fromCss.join(',')}\n         js : ${fromJs.join(',')}`);
}
ok('a name for every slot', M.PALETTE_NAMES.length === M.PALETTE.light.length);

// ── 2. adjacent slots clear both published floors, in both themes ───────────
for (const mode of ['light', 'dark']) {
  const p = M.PALETTE[mode];
  let worstN = Infinity, worstC = Infinity, at = '';
  for (let i = 0; i < p.length - 1; i++) {
    const s = M.separation(p[i], p[i + 1]);
    if (Math.min(s.normal / M.DE_FLOOR, s.cvd / M.CVD_FLOOR) < Math.min(worstN / M.DE_FLOOR, worstC / M.CVD_FLOOR)) {
      worstN = s.normal; worstC = s.cvd; at = `slot ${i + 1}↔${i + 2}`;
    }
  }
  ok(`${mode}: every adjacent pair clears ΔE ${M.DE_FLOOR}`, worstN >= M.DE_FLOOR, `worst ${at} = ${worstN.toFixed(1)}`);
  // 6–8 is the documented floor band, legal only alongside secondary encoding
  // — which every console surface ships as the two-letter tag. Below 6 is a
  // hard fail no tag rescues.
  ok(`${mode}: every adjacent pair clears colourblind ΔE ${M.CVD_FLOOR}`, worstC >= M.CVD_FLOOR, `worst ${at} = ${worstC.toFixed(1)}`);
  if (worstC < M.CVD_TARGET) console.log(`  note  ${mode}: worst adjacent colourblind pair ${at} is ${worstC.toFixed(1)} — inside the ${M.CVD_FLOOR}–${M.CVD_TARGET} band, carried by the tag`);
}

// ── 3. the maths itself ────────────────────────────────────────────────────
ok('identical colours measure zero', M.deltaE('#2a78d6', '#2a78d6') === 0);
ok('black↔white is the maximum', M.deltaE('#000000', '#ffffff') > 99);
ok('an unmeasurable colour is never reported as a clash', M.deltaE('nope', '#2a78d6') === Infinity);
ok('#abc expands to #aabbcc', M.normalizeHex('#abc') === '#aabbcc');
ok('a non-colour normalizes to null, not a guess', M.normalizeHex('rgb(1,2,3)') === null);
// The pair from the live report: two greens that scrape past the floor.
const reported = M.separation('#008300', '#1baf7a');
ok('the reported green↔aqua pair is measurably marginal', reported.normal > 15 && reported.normal < 17,
  `ΔE ${reported.normal.toFixed(1)}`);

// ── 4. resolution order ────────────────────────────────────────────────────
{
  const ws = [
    { id: 1, name: 'Custom', accent_color: '#111111', console_color: '#eb6834' },
    { id: 2, name: 'Branded', accent_color: '#2f5f43', console_color: null },
    { id: 3, name: 'Bare', accent_color: null, console_color: null },
    { id: 4, name: 'Bare Two', accent_color: '', console_color: '' },
  ];
  const r = M.resolveColors(ws, 'light');
  ok('an operator override beats the brand accent', r.get(1).color === '#eb6834' && r.get(1).source === 'custom');
  ok('the brand accent is the default', r.get(2).color === '#2f5f43' && r.get(2).source === 'brand');
  ok('no brand colour falls back to the palette', r.get(3).source === 'auto' && r.get(4).source === 'auto');
  ok('empty strings are treated as unset, not as a colour', r.get(4).color === M.PALETTE.light[1]);
  // The bug this replaced: `id % 8` hands out arbitrary pairs, and the
  // palette's guarantee only covers ADJACENT slots.
  ok('auto slots are handed out IN PALETTE ORDER, not by a hash of the id',
    r.get(3).color === M.PALETTE.light[0] && r.get(4).color === M.PALETTE.light[1]);
  ok('dark resolves auto slots to the dark stepping',
    M.resolveColors(ws, 'dark').get(3).color === M.PALETTE.dark[0]);
  ok('a fixed brand colour does NOT change with the theme',
    M.resolveColors(ws, 'dark').get(2).color === '#2f5f43');
  // Rank is over the whole roster, so hiding a workspace cannot repaint others.
  const filtered = M.resolveColors(ws.filter(w => w.id !== 3), 'light');
  ok('removing a LATER workspace does not repaint an earlier one',
    filtered.get(1).color === r.get(1).color && filtered.get(2).color === r.get(2).color);
}

// ── 5. clash detection + the suggestion ────────────────────────────────────
{
  const ws = [
    { id: 1, name: 'Dark Green', accent_color: '#1f3d2b' },
    { id: 2, name: 'Other Green', accent_color: '#2f5f43' },
    { id: 3, name: 'Distinct', accent_color: '#eb6834' },
  ];
  const r = M.resolveColors(ws, 'light');
  const bad = M.similarPairs(ws, r);
  ok('two similar brand greens are caught', bad.length === 1 && bad[0].a.id === 1 && bad[0].b.id === 2,
    `${bad.length} pair(s)`);
  ok('the distinct workspace is not implicated', !bad.some(p => p.a.id === 3 || p.b.id === 3));
  const fix = M.suggestColor(2, ws, r, 'light');
  const after = M.resolveColors(ws.map(w => (w.id === 2 ? { ...w, console_color: fix } : w)), 'light');
  ok('the suggestion resolves the clash', M.similarPairs(ws, after).length === 0, `suggested ${fix}`);
  ok('the suggestion is a palette slot', M.PALETTE.light.includes(fix));
  ok('tritan is reported but never gated', M.separation('#eda100', '#e87ba4').ok === true);
  ok('a lone workspace has nothing to be distinct from', M.suggestColor(1, [ws[0]], M.resolveColors([ws[0]], 'light'), 'light') === M.PALETTE.light[0]);
  ok('no clashes reported when every colour is distinct',
    M.similarPairs([ws[0], ws[2]], M.resolveColors([ws[0], ws[2]], 'light')).length === 0);
}

// ── 6. tags — the encoding that decides ────────────────────────────────────
{
  const ws = [
    { id: 1, name: 'The Nest' }, { id: 2, name: 'The Nook' },
    { id: 3, name: 'Nova Ray' }, { id: 4, name: 'Night Riders' },
    { id: 5, name: 'Nova Ray' }, { id: 6, name: 'NARK' }, { id: 7, name: '   ' },
  ];
  const t = M.tagMap(ws);
  ok('a leading article is dropped', t.get(1) === 'NE' && t.get(2) === 'NO');
  ok('a one-word name gives up two letters', t.get(6) === 'NA');
  ok('colliding initials are resolved', t.get(3) !== t.get(4));
  ok('two workspaces with the SAME name still differ', t.get(3) !== t.get(5));
  ok('a nameless workspace is marked, not crashed', t.get(7) === '??');
  ok('every tag is unique', new Set([...t.values()]).size === ws.length);
  // Stability: a tag must not change because a workspace was filtered off screen.
  const sub = M.tagMap(ws.filter(w => w.id !== 4));
  ok('filtering a workspace does not rename another one', sub.get(3) === t.get(3) && sub.get(1) === t.get(1));
}

console.log(failed
  ? `\ncheck-workspace-colors: ${failed} FAILED`
  : 'check-workspace-colors: palette matches tokens.css, adjacent pairs clear both floors, resolution + tags hold');
process.exit(failed ? 1 : 0);
