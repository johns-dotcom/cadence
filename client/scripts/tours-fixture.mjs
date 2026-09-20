#!/usr/bin/env node
/*
 * tours-fixture — the walkthroughs cannot quietly rot.
 *
 * A tour is prose about a page. Prose drifts silently: a page is renamed, a
 * tour keeps describing the old one, and nobody notices because nothing throws.
 * These are the checks that can be made mechanically:
 *
 *   1. every tour's `path` is a REAL nav destination — a tour for a page that
 *      no longer exists can never be shown, and gates on canView(path) that
 *      will never be true;
 *   2. every nav destination HAS a tour — otherwise the welcome walk, which is
 *      built from the nav, silently skips that page;
 *   3. ids and versions are unique/present — completion is stored per id per
 *      version, so a duplicate id makes one tour permanently "done";
 *   4. every step names a target and has a title and a body;
 *   5. the welcome walk really is built from the nav, in nav order.
 *
 * What it cannot check is whether the words are TRUE. That is the standing
 * rule: a change to a page changes its tour in the same commit and bumps the
 * tour's version (a date).
 *
 * Usage: npm run check:tours
 */
import { createServer } from 'vite';

const ROOT = '/Users/johnskead/Desktop/DevProjects/cadence/client';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };

let failures = 0;
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

const vite = await createServer({
  root: ROOT, configFile: ROOT + '/vite.config.js',
  server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'silent',
});

const { buildNavGroups } = await vite.ssrLoadModule('/src/constants/navConfig.jsx');
const { PAGE_TOURS, buildWelcome, CONSOLE_TOURS, buildConsoleWelcome, allTours, tourForPath } = await vite.ssrLoadModule('/src/tours/index.js');
const { isOnPage } = await vite.ssrLoadModule('/src/components/Tour.jsx');
const { CONSOLE_NAV } = await vite.ssrLoadModule('/src/constants/consoleNav.js');

// The widest nav — every page anyone could reach.
const groups = buildNavGroups({ isAdmin: true, isApprover: true, canView: () => true });
const dests = [];
for (const g of groups) {
  for (const it of g.items || []) {
    const kids = it.tabbed || it.collapsible ? it.children : [it];
    for (const c of kids) dests.push({ path: c.path, label: c.label });
  }
}
const navPaths = new Set(dests.map((d) => d.path));

// 1 — no tour points at a page that is not in the nav
const orphans = PAGE_TOURS.filter((t) => !navPaths.has(t.path));
if (orphans.length) fail(`${orphans.length} tour(s) name a page that is not in the nav: ${orphans.map((t) => `${t.id} → ${t.path}`).join(', ')}`);
else ok(`${PAGE_TOURS.length} tours, every one on a real nav page`);

// 2 — no nav page without a tour
const tourPaths = new Set(PAGE_TOURS.map((t) => t.path));
const uncovered = dests.filter((d) => !tourPaths.has(d.path));
if (uncovered.length) fail(`${uncovered.length} nav page(s) have no tour, so the welcome walk skips them: ${uncovered.map((d) => d.path).join(', ')}`);
else ok(`all ${dests.length} nav destinations have a tour`);

// 3 — ids unique, versions present
const ids = PAGE_TOURS.map((t) => t.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length) fail(`duplicate tour id(s): ${[...new Set(dupes)].join(', ')} — completion is keyed by id, so one would be permanently "done"`);
else ok('tour ids are unique');

const noVersion = PAGE_TOURS.filter((t) => !/^\d{4}-\d{2}-\d{2}$/.test(t.version || ''));
if (noVersion.length) fail(`tour(s) without a dated version: ${noVersion.map((t) => t.id).join(', ')}`);
else ok('every tour carries a dated version');

// 4 — steps are well formed
const badSteps = [];
for (const t of PAGE_TOURS) {
  if (!t.steps?.length) { badSteps.push(`${t.id}: no steps`); continue; }
  t.steps.forEach((s, i) => {
    if (!s.target) badSteps.push(`${t.id}[${i}]: no target`);
    if (!s.title) badSteps.push(`${t.id}[${i}]: no title`);
    if (!s.body) badSteps.push(`${t.id}[${i}]: no body`);
  });
}
if (badSteps.length) fail(`malformed step(s): ${badSteps.slice(0, 5).join('; ')}${badSteps.length > 5 ? ` …and ${badSteps.length - 5} more` : ''}`);
else ok(`${PAGE_TOURS.reduce((n, t) => n + t.steps.length, 0)} steps, each with a target, a title and a body`);

// 5 — the welcome walk is the nav, in order
const welcome = buildWelcome(groups);
const walkPaths = [...new Set(welcome.steps.map((s) => s.path))];
const expected = dests.map((d) => d.path).filter((p) => tourPaths.has(p));
if (walkPaths.join('|') !== expected.join('|')) {
  fail(`the welcome walk does not follow the nav: ${walkPaths.length} pages vs ${expected.length} expected`);
} else {
  ok(`welcome walk covers ${walkPaths.length} pages in nav order (${welcome.steps.length} steps)`);
}

// ── The operator console ───────────────────────────────────────────────────
console.log('console:');
const consolePaths = CONSOLE_NAV.map((n) => n.path);
const consoleTourPaths = CONSOLE_TOURS.map((t) => t.path);

const cOrphans = CONSOLE_TOURS.filter((t) => !consolePaths.includes(t.path));
if (cOrphans.length) fail(`console tour(s) on a page not in CONSOLE_NAV: ${cOrphans.map((t) => t.id).join(', ')}`);
else ok(`${CONSOLE_TOURS.length} console tours, every one on a real console page`);

const cUncovered = consolePaths.filter((p) => !consoleTourPaths.includes(p));
if (cUncovered.length) fail(`console page(s) with no tour: ${cUncovered.join(', ')}`);
else ok(`all ${consolePaths.length} console pages have a tour`);

// THE COLLISION. Both shells route `/`, `/my-work`, `/messages` and
// `/calendar` to DIFFERENT pages. Choosing a tour by path alone would describe
// the wrong one, so the two sets must never share an id — that is what proves
// the engine is picking by shell and not by path.
const shared = consolePaths.filter((p) => PAGE_TOURS.some((t) => t.path === p));
const idClash = CONSOLE_TOURS.filter((c) => PAGE_TOURS.some((t) => t.id === c.id));
if (idClash.length) fail(`a tour id exists in BOTH shells: ${idClash.map((t) => t.id).join(', ')} — completion is stored per id, so finishing one would mark the other done`);
else ok(`${shared.length} paths exist in both shells (${shared.join(', ')}) and no tour id is shared`);

const cWelcome = buildConsoleWelcome(CONSOLE_NAV);
const cWalk = [...new Set(cWelcome.steps.map((s) => s.path))];
if (cWalk.join('|') !== consolePaths.filter((p) => consoleTourPaths.includes(p)).join('|')) {
  fail('the console welcome walk does not follow CONSOLE_NAV');
} else {
  ok(`console welcome covers ${cWalk.length} pages in nav order (${cWelcome.steps.length} steps)`);
}

// A tenant tour must never be reachable from the console walk, or it would
// navigate an operator to a route that does not exist in their shell.
const tenantOnly = PAGE_TOURS.map((t) => t.path).filter((p) => !consolePaths.includes(p));
const leaked = cWelcome.steps.filter((s) => tenantOnly.includes(s.path));
if (leaked.length) fail(`the console walk visits ${leaked.length} page(s) that are not console routes`);
else ok('the console walk never leaves the console');

// Every shared path must resolve to ITS OWN shell's tour, and a multipage walk
// must never be returned as a page tour — both welcome walks carry path '/',
// and an id-based exclusion missed the console one, making the Overview's page
// tour the whole walk (which then auto-started itself on every visit to '/').
const conSet = allTours({ shell: 'console' });
const tenSet = allTours({ shell: 'tenant', isAdmin: true, isApprover: true, canView: () => true });
const wrong = [];
for (const p of shared) {
  const c = tourForPath(conSet, p);
  const t = tourForPath(tenSet, p);
  if (!c || !t) { wrong.push(`${p}: missing a tour in one shell`); continue; }
  if (c.id === t.id) wrong.push(`${p}: both shells resolve to ${c.id}`);
  if (c.multipage || t.multipage) wrong.push(`${p}: a multipage walk was returned as a page tour`);
}
if (wrong.length) fail(`shell resolution: ${wrong.join('; ')}`);
else ok(`each shared path resolves to its own shell's tour`);

// The on-page test. A step that cannot recognise its own page is DROPPED as
// "a guard redirected us" — which is how the walk came to skip Messages, whose
// /messages redirects to /messages/<channelId> the moment it picks a channel.
const onPageCases = [
  ['/messages', '/messages', true],
  ['/messages/3', '/messages', true],          // the redirect that caused the skip
  ['/recoupments/planning', '/recoupments', true],
  ['/ledger', '/ledger', true],
  ['/ledger-matching', '/ledger', false],      // segment boundary, not startsWith
  ['/', '/', true],
  ['/artists', '/', false],                    // '/' must not match everything
];
const onPageBad = onPageCases.filter(([p, w, want]) => isOnPage(p, w) !== want);
if (onPageBad.length) fail(`isOnPage: ${onPageBad.map(([p, w, want]) => `${p} vs ${w} should be ${want}`).join('; ')}`);
else ok('a step recognises its page through a redirect, and stops at a segment boundary');

await vite.close();
if (failures) { console.error(`tours-fixture: ${failures} failure(s)`); process.exit(1); }
console.log('tours-fixture: clean');
