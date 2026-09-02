#!/usr/bin/env node
/*
 * check-render — prove every route in App.jsx actually renders.
 *
 * Why this exists: `vite build` is a bundler, not an interpreter. It never
 * executes a component, so it cannot catch a JSX element whose identifier was
 * never imported (a missing name in a lucide import white-screened every page
 * for every Approver+ and built perfectly cleanly), a destructure of an
 * undefined value at render time, or a hook order violation. check-tdz.cjs
 * covers one static class; this covers the executable ones.
 *
 * How: Vite's own SSR module loader (`ssrLoadModule`) executes each page module
 * for real, then React's server renderer renders it inside the app's providers.
 * Auth and Socket contexts are stubbed so every page renders as a signed-in
 * Superadmin — without that, `loading` never flips (SSR runs no effects) and
 * every page would render only its spinner, proving nothing.
 *
 * What it does NOT prove: anything after the first paint. Effects, data
 * fetching, event handlers, layout and CSS are all out of scope — this is a
 * "does it throw" gate, not a browser.
 *
 * Usage:
 *   node scripts/check-render.mjs           # parses src/App.jsx itself
 *   node scripts/check-render.mjs r.json    # explicit route list (CI/debug)
 *   npm run check:render
 *
 * Exits 1 if any route fails to load or render.
 */
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'fs';

const ROOT = '/Users/johnskead/Desktop/DevProjects/cadence/client';

// ── Minimal browser shims: enough for module scope + first render ───────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.sessionStorage = globalThis.localStorage;
const noopEl = { style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false} },
  setAttribute(){}, removeAttribute(){}, getAttribute(){return null}, appendChild(){}, removeChild(){},
  addEventListener(){}, removeEventListener(){}, contains(){return false}, focus(){}, querySelector(){return null},
  querySelectorAll(){return []}, getBoundingClientRect(){return {top:0,left:0,width:0,height:0,bottom:0,right:0}} };
globalThis.document = {
  documentElement: noopEl, body: noopEl, head: noopEl,
  createElement: () => ({ ...noopEl }), createTextNode: () => ({}),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener(){}, removeEventListener(){}, contains(){return false},
  cookie: '', title: '', visibilityState: 'visible',
};
globalThis.window = {
  location: { pathname: '/', search: '', hash: '', href: 'http://localhost/', origin: 'http://localhost', assign(){}, replace(){} },
  localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage,
  document: globalThis.document, navigator: { userAgent: 'node', language: 'en-US', clipboard: { writeText: async()=>{} } },
  addEventListener(){}, removeEventListener(){}, dispatchEvent(){return true},
  matchMedia: () => ({ matches: false, media: '', addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: () => {},
  innerWidth: 1440, innerHeight: 900, scrollTo(){}, open(){ return null }, print(){},
  ResizeObserver: class { observe(){} unobserve(){} disconnect(){} },
  IntersectionObserver: class { observe(){} unobserve(){} disconnect(){} },
};
try { Object.defineProperty(globalThis, 'navigator', { value: globalThis.window.navigator, configurable: true }); } catch {}
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.getComputedStyle = globalThis.window.getComputedStyle;
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
globalThis.ResizeObserver = globalThis.window.ResizeObserver;
globalThis.IntersectionObserver = globalThis.window.IntersectionObserver;
globalThis.HTMLElement = class {};
globalThis.Element = class {};

// React warns on every useLayoutEffect during SSR. That is expected here and
// says nothing about correctness — keep it out of the signal.
const _err = console.error;
console.error = (...a) => { if (/useLayoutEffect does nothing on the server/.test(String(a[0]))) return; _err(...a); };

// AuthContext + SocketContext are replaced with stubs so every page renders as
// a signed-in Superadmin. Without this, `loading` never flips (SSR does not run
// useEffect) and every page would render only its spinner — proving nothing.
const STUB_AUTH = `
import React from 'react';
const user = { id: 1, label_id: 2, name: 'QA Superadmin', email: 'dev@cadence.local',
  role: 'Superadmin', department: 'Executive', hierarchy_level: 1,
  is_platform_admin: true, platform_role: 'owner' };
const label = { id: 2, name: 'Audit Test Label', slug: 'audit-test-label', accent_color: null,
  logo_url: null, vendor_form_token: 'qa', settings: {} };
const value = { user, label, token: 'qa-token', loading: false, pagePermissions: null,
  impersonating: false, adminUser: null, canView: () => true,
  login: async () => {}, googleLogin: async () => {}, logout: () => {},
  updateLabel: () => {}, impersonate: async () => {}, enterWorkspace: async () => {},
  exitImpersonation: () => {} };
export const AuthProvider = ({ children }) => React.createElement(React.Fragment, null, children);
export const useAuth = () => value;
export default { AuthProvider, useAuth };
`;
const STUB_SOCKET = `
import React from 'react';
const value = { socket: null, connected: false, online: new Set(),
  on: () => () => {}, off: () => {}, emit: () => {} };
export const SocketProvider = ({ children }) => React.createElement(React.Fragment, null, children);
export function useSocket() { return value; }
export default { SocketProvider, useSocket };
`;
const stubPlugin = {
  name: 'qa-stubs',
  enforce: 'pre',
  load(id) {
    if (id.endsWith('/src/context/AuthContext.jsx')) return STUB_AUTH;
    if (id.endsWith('/src/context/SocketContext.jsx')) return STUB_SOCKET;
    return null;
  },
};

const vite = await createServer({
  root: ROOT,
  configFile: ROOT + '/vite.config.js',
  plugins: [stubPlugin],
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'silent',
});

const results = [];
const load = (p) => vite.ssrLoadModule(p);


// Route table — parsed from App.jsx itself so this can never drift from the
// app. An explicit JSON file may still be passed for CI or debugging.
function parseRoutes() {
  const src = fs.readFileSync(ROOT + '/src/App.jsx', 'utf8');
  const imports = {};
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g)) imports[m[1]] = m[2];
  const GATES = ['AdminRoute', 'StrictAdminRoute', 'ProtectedRoute', 'Navigate'];
  const PARAM = { ':id': '3', ':slug': 'qa-token', ':artist': 'Artist%20B', ':song': 'Song%20A',
    ':key': 'artistb', ':artistKey': 'artistb', ':template': 'mutual', ':channelId': '2',
    ':month': '2026-06' };
  const out = [];
  for (const m of src.matchAll(/<Route\s+path=['"]([^'"]+)['"]\s+element=\{([\s\S]*?)\}\s*\/>/g)) {
    const routePath = m[1], el = m[2];
    const names = (el.match(/<(\w+)/g) || []).map(x => x.slice(1));
    let component = names.filter(c => !GATES.includes(c))[0] || null;
    let file = component && imports[component] ? '/src/' + imports[component].replace(/^\.\//, '') : null;
    const props = {};
    if (component) {
      const pm = el.match(new RegExp('<' + component + '([^>]*?)/?>'));
      if (pm) {
        for (const a of pm[1].matchAll(/(\w+)=["']([^"']+)["']/g)) props[a[1]] = a[2];
        for (const a of pm[1].matchAll(/(?:^|\s)([a-z]\w*)(?=\s|$)/g)) if (props[a[1]] === undefined) props[a[1]] = true;
      }
    }
    // Locally-defined wrappers in App.jsx resolve to what they actually render.
    if (component === 'ManualPage') { component = 'UserManual'; file = '/src/components/UserManual.jsx'; }
    if (routePath === '*') { component = 'NotFound'; file = '/src/components/NotFound.jsx'; }
    if (!file) continue;
    if (!/\.(jsx|js)$/.test(file)) file += '.jsx';
    out.push({ path: routePath, component, file,
      props: component === 'UserManual' ? { open: true } : props,
      concrete: routePath === '*' ? '/does-not-exist' : routePath.replace(/:\w+/g, (k) => PARAM[k] || '1') });
  }
  return out;
}
const routes = process.argv[2]
  ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  : parseRoutes();

// ── Shell pre-flight ───────────────────────────────────────────────────────
// The per-route checks below render pages STANDALONE, without Layout. But
// Layout builds the sidebar on every authenticated page, so a throw inside
// buildNavGroups white-screens the entire app rather than one route — exactly
// what a missing icon import did. Exercise it for every role before anything
// else, because "one page is broken" and "the app is gone" are not the same
// finding and the route table alone cannot tell them apart.
const shellFailures = [];
try {
  const { buildNavGroups, PAGE_LABELS } = await load('/src/constants/navConfig.jsx');
  for (const role of [
    { name: 'Admin/Superadmin', isAdmin: true, isApprover: true },
    { name: 'Approver', isAdmin: false, isApprover: true },
    { name: 'User', isAdmin: false, isApprover: false },
  ]) {
    try {
      const groups = buildNavGroups(role);
      const items = groups.flatMap((g) => g.items);
      const noIcon = items.filter((i) => !i.icon).map((i) => i.path);
      if (noIcon.length) shellFailures.push(`${role.name}: nav items with no icon — ${noIcon.join(', ')}`);
      // A nav entry pointing at a route that does not exist is worse than a
      // missing one: it is a dead link the user is invited to click.
      const declared = new Set(routes.map((r) => r.path));
      const dead = items.map((i) => i.path).filter((p) => !declared.has(p));
      if (dead.length) shellFailures.push(`${role.name}: nav entries with no <Route> — ${dead.join(', ')}`);
    } catch (e) {
      shellFailures.push(`${role.name}: buildNavGroups THREW — ${e.message} (this white-screens every page for this role)`);
    }
  }
  const declared = new Set(routes.map((r) => r.path));
  const orphanLabels = Object.keys(PAGE_LABELS || {}).filter((p) => !declared.has(p));
  if (orphanLabels.length) shellFailures.push(`PAGE_LABELS keys with no <Route> — ${orphanLabels.join(', ')}`);
} catch (e) {
  shellFailures.push(`navConfig failed to load — ${e.message}`);
}
for (const f of shellFailures) console.error('SHELL  ' + f);

const { MemoryRouter, Routes, Route } = await load('react-router-dom');
const { ThemeProvider } = await load('/src/context/ThemeContext.jsx');
const { ToastProvider } = await load('/src/context/ToastContext.jsx');
const { AuthProvider } = await load('/src/context/AuthContext.jsx');
const { SocketProvider } = await load('/src/context/SocketContext.jsx');

for (const r of routes) {
  const entry = { route: r.path, component: r.component, file: r.file };
  let Comp;
  try {
    const mod = await load(r.file);
    Comp = mod.default;
    if (typeof Comp !== 'function' && typeof Comp !== 'object') {
      entry.status = 'NO_DEFAULT_EXPORT'; results.push(entry); continue;
    }
    entry.loaded = true;
  } catch (e) {
    entry.status = 'MODULE_LOAD_FAIL';
    entry.error = (e && e.message) || String(e);
    entry.stack = (e && e.stack || '').split('\n').slice(0, 4).join(' | ');
    results.push(entry); continue;
  }
  try {
    const el = React.createElement(ThemeProvider, null,
      React.createElement(ToastProvider, null,
        React.createElement(AuthProvider, null,
          React.createElement(SocketProvider, null,
            React.createElement(MemoryRouter, { initialEntries: [r.concrete || r.path] },
              React.createElement(Routes, null,
                React.createElement(Route, { path: r.path, element: React.createElement(Comp, r.props || {}) })
              )
            )
          )
        )
      )
    );
    const html = renderToString(el);
    entry.status = 'RENDERED';
    entry.bytes = html.length;
  } catch (e) {
    entry.status = 'RENDER_FAIL';
    entry.error = (e && e.message) || String(e);
    entry.stack = (e && e.stack || '').split('\n').slice(1, 5).join(' | ');
  }
  results.push(entry);
}


const by = {}; results.forEach(x => by[x.status] = (by[x.status] || 0) + 1);
const bad = results.filter(x => x.status !== 'RENDERED');
for (const x of bad) {
  console.error(`${x.status}  ${x.route}  <${x.component}>  ${x.file}`);
  console.error(`   ${x.error}`);
  if (x.stack) console.error(`   ${x.stack}`);
}
await vite.close();
if (bad.length || shellFailures.length) {
  if (shellFailures.length) console.error(`\ncheck-render: ${shellFailures.length} SHELL failure(s) — these affect every page, not one route.`);
  if (bad.length) console.error(`check-render: ${bad.length} of ${results.length} route(s) FAILED — these throw at runtime, not at build time.`);
  process.exit(1);
}
console.log(`check-render: shell clean for all roles; ${results.length} route(s) rendered clean`);
process.exit(0);
