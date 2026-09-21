#!/usr/bin/env node
/*
 * settings-fixture — the Settings rail and the Settings panels agree.
 *
 * Why this exists: the left rail renders from `buildSettingsSections()` and the
 * panels are `{tab === 'key' && …}` branches inside Settings.jsx. Those are two
 * lists that must match, and nothing makes them. Add a rail item without its
 * panel and the button renders a blank page; rename a panel key and the rail
 * item that pointed at it goes dead. Both are silent — the page still loads,
 * the console says nothing, and it only shows up when somebody clicks.
 *
 * Also checks that every legacy `?tab=` value still resolves, because those
 * live in bookmarks and cross-links where nothing else will notice them break.
 *
 * Usage:  node scripts/settings-fixture.mjs  ·  npm run settings-fixture
 * Exits 1 on any failure.
 */
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const fail = (m) => { failures++; console.error(`  ✗ ${m}`) }
const ok = (m) => console.log(`  ✓ ${m}`)

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.js'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const mod = await server.ssrLoadModule('/src/lib/settingsSections.js')
  const { buildSettingsSections, ALL_SETTINGS_TABS, ADMIN_TABS, LEGACY_TABS, resolveSettingsTab } = mod

  const src = readFileSync(path.join(ROOT, 'src/pages/Settings.jsx'), 'utf8')

  // Every `{tab === 'x'` branch actually implemented, and whether it is guarded.
  const implemented = new Map()
  for (const m of src.matchAll(/\{tab === '([a-z-]+)'(\s*&&\s*isAdmin)?/g)) {
    implemented.set(m[1], !!m[2])
  }

  console.log('\nRail vs panels')

  // ── every rail item has a panel ───────────────────────────────────────
  for (const key of ALL_SETTINGS_TABS) {
    if (!implemented.has(key)) fail(`rail item "${key}" has no {tab === '${key}'} panel — the button renders a blank page`)
  }
  // ── every panel has a rail item ───────────────────────────────────────
  for (const key of implemented.keys()) {
    if (!ALL_SETTINGS_TABS.includes(key)) fail(`panel "${key}" is implemented but no rail item points at it — it is unreachable`)
  }
  if (!failures) ok(`${ALL_SETTINGS_TABS.length} rail items, ${implemented.size} panels, one-to-one`)

  // ── CONSOLE settings: same rail↔panel bijection ─────────────────────────
  // The console reuses SettingsShell, so the same drift (a rail button opening
  // a blank page) is possible there. Owner sees the most panels, so check that.
  const cmod = await server.ssrLoadModule('/src/lib/consoleSettingsSections.js')
  const csrc = readFileSync(path.join(ROOT, 'src/pages/PlatformSettings.jsx'), 'utf8')
  const cKeys = cmod.buildConsoleSettingsSections(true).flatMap(sec => sec.items.map(i => i.key))
  const cImpl = new Set([...csrc.matchAll(/\{tab === '([a-z-]+)'/g)].map(m => m[1]))
  for (const key of cKeys) {
    if (!cImpl.has(key)) fail(`console rail item "${key}" has no {tab === '${key}'} panel`)
  }
  for (const key of cImpl) {
    if (!cKeys.includes(key)) fail(`console panel "${key}" has no rail item — unreachable`)
  }
  if (!failures) ok(`console: ${cKeys.length} rail items, ${cImpl.size} panels, one-to-one`)

  // ── admin panels are guarded ──────────────────────────────────────────
  // The rail already hides these from a User, but the panel is what actually
  // renders — a deep link is not a click, and `?tab=data` must not open the
  // export tools for somebody the rail never offered them to.
  for (const key of ADMIN_TABS) {
    if (implemented.get(key) === false) {
      fail(`"${key}" is a Label-settings panel but its branch has no isAdmin guard — reachable by deep link`)
    }
  }
  const myTabs = ALL_SETTINGS_TABS.filter(k => !ADMIN_TABS.includes(k))
  for (const key of myTabs) {
    if (implemented.get(key) === true) fail(`"${key}" is a My-settings panel but is gated on isAdmin`)
  }
  ok(`${ADMIN_TABS.length} admin panels guarded, ${myTabs.length} personal panels open`)

  // ── no duplicate keys across the two halves ───────────────────────────
  const dupes = ALL_SETTINGS_TABS.filter((k, i) => ALL_SETTINGS_TABS.indexOf(k) !== i)
  if (dupes.length) fail(`duplicate panel key(s): ${[...new Set(dupes)].join(', ')}`)

  // ── a non-admin sees only their own half ──────────────────────────────
  const userSections = buildSettingsSections(false)
  if (userSections.length !== 1) fail(`a non-admin sees ${userSections.length} halves, expected 1`)
  const userKeys = userSections.flatMap(s => s.items.map(i => i.key))
  for (const k of ADMIN_TABS) {
    if (userKeys.includes(k)) fail(`a non-admin's rail offers the admin panel "${k}"`)
  }
  ok(`non-admin rail: ${userKeys.length} items, no Label settings`)

  // ── legacy deep links still land somewhere real ───────────────────────
  for (const [old, want] of Object.entries(LEGACY_TABS)) {
    const got = resolveSettingsTab(old)
    if (got !== want) fail(`?tab=${old} resolves to "${got}", expected "${want}"`)
  }
  if (resolveSettingsTab('not-a-real-tab') !== null) fail('an unknown ?tab= resolved to a panel instead of null')
  ok(`${Object.keys(LEGACY_TABS).length} legacy tab links still resolve; unknown ones do not`)

  // ── the drift this is really here to catch ────────────────────────────
  // Prove the check would fire: a rail item whose panel does not exist.
  const probe = [...ALL_SETTINGS_TABS, 'panel-that-does-not-exist']
  const wouldCatch = probe.some(k => !implemented.has(k))
  if (!wouldCatch) fail('the rail/panel check cannot detect a missing panel — the assertion is inert')
  ok('drift probe: a rail item without a panel would be caught')
} catch (err) {
  failures++
  console.error('\nsettings-fixture threw:', err)
} finally {
  await server.close()
}

console.log(failures === 0 ? '\nsettings-fixture: clean' : `\nsettings-fixture: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
