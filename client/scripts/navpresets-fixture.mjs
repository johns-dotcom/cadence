#!/usr/bin/env node
/*
 * navpresets-fixture — the page presets are made of real pages.
 *
 * Why this exists: a preset is a list of path strings, and nothing checks them.
 * `/bank-statement` instead of `/bank-statements` grants nothing, silently —
 * the admin ticks the preset, the save succeeds, and the person signs in
 * missing a page nobody can explain. The same happens the day a path is renamed
 * and the presets are not, which is the more likely failure.
 *
 * Also checks the seam the other way: every preset must be reachable through
 * the real `canView` rule, not just present in the page list, or a preset could
 * grant a path the permission check can never satisfy.
 *
 * Usage:  node scripts/navpresets-fixture.mjs  ·  npm run navpresets-fixture
 * Exits 1 on any failure.
 */
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const fail = (m) => { failures++; console.error(`  ✗ ${m}`) }
const ok = (m) => console.log(`  ✓ ${m}`)

// The permission rule from AuthContext.canView, restated. If these ever drift
// the fixture is worthless, so it is written to mirror the real one exactly:
// a grant on a parent path covers its carved-out subpages.
const covers = (granted, path_) =>
  granted.some(p => path_ === p || (p !== '/' && path_.startsWith(p + '/')))

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.js'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const presets = await server.ssrLoadModule('/src/lib/navPresets.js')
  const pages = await server.ssrLoadModule('/src/constants/pages.js')
  const nav = await server.ssrLoadModule('/src/constants/navConfig.jsx')

  const { NAV_PRESETS, FULL_ACCESS, addPreset, presetCoverage, presetForDepartment } = presets
  const { ALL_PAGES } = pages
  const { PAGE_LABELS } = nav

  const all = new Set(ALL_PAGES)
  const navPaths = new Set(Object.keys(PAGE_LABELS))

  console.log('\nPresets')
  for (const preset of [...NAV_PRESETS, FULL_ACCESS]) {
    // ── every path is a page the permission editor can actually tick ──────
    for (const p of preset.pages) {
      if (!all.has(p)) fail(`${preset.id}: "${p}" is not in ALL_PAGES — it would grant nothing`)
    }
    // ── and a route the app actually has ─────────────────────────────────
    for (const p of preset.pages) {
      if (!navPaths.has(p)) fail(`${preset.id}: "${p}" is not a known page path (PAGE_LABELS)`)
    }
    // ── no duplicates: a list that says a page twice is a list being edited
    //    by hand without anyone reading it ───────────────────────────────
    const dupes = preset.pages.filter((p, i) => preset.pages.indexOf(p) !== i)
    if (dupes.length) fail(`${preset.id}: repeats ${[...new Set(dupes)].join(', ')}`)

    // ── the floor: a grant set without these is an account that signs in to
    //    a dashboard it cannot open ──────────────────────────────────────
    for (const floor of ['/', '/my-work']) {
      if (!preset.pages.includes(floor)) fail(`${preset.id}: missing the floor page "${floor}"`)
    }

    // ── every page it grants is reachable under the real canView rule ────
    for (const p of preset.pages) {
      if (!covers(preset.pages, p)) fail(`${preset.id}: grants "${p}" but canView would refuse it`)
    }
  }
  ok(`${NAV_PRESETS.length} presets + Full access, all paths real`)

  // ── additive, not replacing. The whole point of the change. ────────────
  const anr = NAV_PRESETS.find(p => p.id === 'anr')
  const marketing = NAV_PRESETS.find(p => p.id === 'marketing')
  if (anr && marketing) {
    let set = new Set()
    set = addPreset(set, 'anr')
    const afterFirst = new Set(set)
    set = addPreset(set, 'marketing')
    for (const p of anr.pages) {
      if (!set.has(p)) fail(`addPreset dropped "${p}" from A&R when Marketing was added — presets must union`)
    }
    for (const p of marketing.pages) {
      if (!set.has(p)) fail(`addPreset did not add "${p}" from Marketing`)
    }
    if (set.size <= afterFirst.size) fail('adding a second preset granted nothing new')
    ok(`A&R (${anr.pages.length}) + Marketing (${marketing.pages.length}) unions to ${set.size} pages`)
  } else {
    fail('expected presets "anr" and "marketing" to exist')
  }

  // ── coverage states are honest ─────────────────────────────────────────
  if (anr) {
    const full = presetCoverage(new Set(anr.pages), 'anr')
    if (full.state !== 'full') fail(`coverage of a fully granted preset reported "${full.state}"`)

    // The floor alone must NOT light a preset up, or every preset reads as
    // partially on for an empty selection.
    const floorOnly = presetCoverage(new Set(['/', '/my-work']), 'anr')
    if (floorOnly.state !== 'none') fail(`the floor alone reported coverage "${floorOnly.state}", expected "none"`)

    const partial = presetCoverage(new Set(['/', '/my-work', '/deals']), 'anr')
    if (partial.state !== 'partial') fail(`a part-granted preset reported "${partial.state}", expected "partial"`)
    ok('coverage states: full / partial / none behave')
  }

  // ── department seeding points at presets that exist ────────────────────
  const seeded = NAV_PRESETS.filter(p => p.department)
  for (const p of seeded) {
    const found = presetForDepartment(p.department)
    if (!found || found.id !== p.id) {
      fail(`presetForDepartment("${p.department}") did not return "${p.id}"`)
    }
  }
  // Two presets claiming the same department means one of them never seeds.
  const byDept = new Map()
  for (const p of seeded) {
    if (byDept.has(p.department)) fail(`"${p.department}" is claimed by both ${byDept.get(p.department)} and ${p.id}`)
    byDept.set(p.department, p.id)
  }
  if (presetForDepartment('Department That Does Not Exist') !== null) {
    fail('an unknown department returned a preset instead of null')
  }
  ok(`${seeded.length} departments seed a preset; unknown departments seed nothing`)
} catch (err) {
  failures++
  console.error('\nnavpresets-fixture threw:', err)
} finally {
  await server.close()
}

console.log(failures === 0 ? '\nnavpresets-fixture: clean' : `\nnavpresets-fixture: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
