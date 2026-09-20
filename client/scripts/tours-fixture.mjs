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
const { PAGE_TOURS, buildWelcome } = await vite.ssrLoadModule('/src/tours/index.js');

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

await vite.close();
if (failures) { console.error(`tours-fixture: ${failures} failure(s)`); process.exit(1); }
console.log('tours-fixture: clean');
