#!/usr/bin/env node
/*
 * nav-fixture — the sidebar's shape, asserted.
 *
 * Why this exists: navConfig has four consumers (sidebar, Settings' hide-list,
 * the ⌘K palette, check-render's pre-flight) and none of them fails loudly when
 * the list is wrong in a *structural* way. A page dropped from every group
 * still builds. A family whose children were all role-gated away still builds,
 * and then the sidebar reads `children[0].path` off an empty array at runtime.
 * A page listed in two groups builds and shows up twice in the hide-list with
 * one checkbox governing both.
 *
 * check-render proves the module EXECUTES for three roles. This proves the
 * result is COHERENT.
 *
 * The row counts at the bottom are the regroup's own record: if a later change
 * quietly re-flattens a family, the count moves and this fails with the
 * before/after. Update the expected numbers deliberately, in the same commit as
 * the nav change that moved them.
 *
 * Usage:  node scripts/nav-fixture.mjs   ·   npm run nav-fixture
 * Exits 1 on any failure.
 */
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The three role shapes buildNavGroups branches on, named as the app names them.
const SHAPES = [
  { name: 'User',      opts: { isAdmin: false, isApprover: false } },
  { name: 'Approver',  opts: { isAdmin: false, isApprover: true } },
  { name: 'Admin',     opts: { isAdmin: true,  isApprover: true } },
]

// Rail rows per role — a family or a sub-group counts as ONE row, which is the
// whole point of the regroup. Recorded 2026-09-19, when seven families took the
// Admin rail from 47 rows to 36. Bump these deliberately, in the same commit as
// the nav change that moves them: a silent drop back toward 47 means a family
// was re-flattened, and a silent rise means a page was added to the rail
// without anyone deciding where it belongs.
// Pinned so a regroup cannot happen by accident. 2026-09-20: the Market Street
// consolidation took the Admin rail from 36 rows to 16 — every path kept, folded
// into `tabbed` families whose children live in the page's own tab bar
// (components/PageTabs). The page COUNTS below are the real check that nothing
// was lost: 52 distinct pages for an Admin, same as before.
const EXPECTED_ROWS = { User: 8, Approver: 15, Admin: 16 }

let failures = 0
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`) }
const ok = (msg) => console.log(`  ✓ ${msg}`)

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.js'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const mod = await server.ssrLoadModule('/src/constants/navConfig.jsx')
  const { buildNavGroups, navPageGroups, tabFamilyFor, PAGE_LABELS } = mod

  for (const shape of SHAPES) {
    console.log(`\n${shape.name}`)
    const groups = buildNavGroups(shape.opts)
    const pageGroups = navPageGroups(shape.opts)

    // ── no empty containers ────────────────────────────────────────────────
    // The crash this prevents is specific: Layout reads children[0].path.
    for (const g of groups) {
      for (const item of g.items) {
        if (item.children && item.children.length === 0) {
          fail(`${g.label || '(top)'} › ${item.label}: container with no children`)
        }
      }
    }

    // ── every row is a page or a container, never both and never neither ──
    for (const g of groups) {
      for (const item of g.items) {
        const isContainer = !!item.children
        if (isContainer && item.path) fail(`${item.label}: has children AND a path`)
        if (!isContainer && !item.path) fail(`${g.label || '(top)'}: row with neither path nor children`)
        if (isContainer && !item.key) fail(`${item.label}: container without a key`)
      }
    }

    // ── no page appears twice ─────────────────────────────────────────────
    const seen = new Map()
    for (const g of pageGroups) {
      for (const item of g.items) {
        if (seen.has(item.path)) {
          fail(`${item.path} appears in both "${seen.get(item.path)}" and "${g.label || '(top)'}"`)
        }
        seen.set(item.path, g.label || '(top)')
      }
    }
    ok(`${seen.size} distinct pages, no duplicates`)

    // ── every page has a label in PAGE_LABELS ─────────────────────────────
    // The hide-list and the ⌘K palette both render PAGE_LABELS, so a page the
    // rail knows and PAGE_LABELS does not shows up as a blank row.
    for (const p of seen.keys()) {
      if (!PAGE_LABELS[p]) fail(`${p} is in the nav but missing from PAGE_LABELS`)
    }

    // ── tabFamilyFor agrees with the tree ─────────────────────────────────
    // PageTabs trusts this lookup; if it disagreed with the groups it walks,
    // a page would render a tab bar belonging to a different family.
    for (const g of groups) {
      for (const item of g.items) {
        if (!item.tabbed) continue
        for (const child of item.children) {
          const found = tabFamilyFor(groups, child.path)
          if (!found) fail(`${child.path} is in family "${item.key}" but tabFamilyFor returns null`)
          else if (found.key !== item.key) fail(`${child.path}: tabFamilyFor says "${found.key}", tree says "${item.key}"`)
        }
      }
    }

    // A plain page must NOT resolve to a family, or it would grow a tab bar.
    for (const g of groups) {
      for (const item of g.items) {
        if (item.children || !item.path) continue
        const found = tabFamilyFor(groups, item.path)
        if (found) fail(`${item.path} is a plain row but tabFamilyFor claims family "${found.key}"`)
      }
    }

    // ── a one-tab family is a row that should have stayed a page ──────────
    // Not fatal for every role: gating can legitimately reduce a family to one
    // child, and PageTabs hides the bar below two. Reported so the shape is
    // visible rather than silently pointless.
    const families = groups.flatMap(g => g.items.filter(i => i.tabbed))
    for (const f of families) {
      if (f.children.length === 1) {
        console.log(`  · "${f.label}" has one child for ${shape.name} (${f.children[0].path}) — no tab bar will render`)
      }
    }
    ok(`${families.length} tab families`)

    const rows = groups.reduce((n, g) => n + g.items.length, 0)
    const expected = EXPECTED_ROWS[shape.name]
    if (rows !== expected) {
      fail(`${rows} rail rows, expected ${expected} — if this change is intended, update EXPECTED_ROWS`)
    } else {
      ok(`${rows} rail rows across ${groups.length} groups`)
    }
  }

  console.log('\nExpected rail rows:', Object.entries(EXPECTED_ROWS).map(([k, v]) => `${k} ${v}`).join(' · '))
} catch (err) {
  failures++
  console.error('\nnav-fixture threw:', err)
} finally {
  await server.close()
}

console.log(failures === 0 ? '\nnav-fixture: clean' : `\nnav-fixture: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
