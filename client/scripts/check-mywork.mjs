#!/usr/bin/env node
/*
 * check-mywork — prove /my-work renders its CONTENT, not just without throwing.
 *
 * check-render.mjs stubs no data, so every data-driven page there renders its
 * loading branch: it proves nothing threw, which is all it claims. This page is
 * worth one step further, because its correctness IS its arithmetic — the tab
 * badges, the status pills and the To Do Today sections are three reductions
 * over one task array, and the whole point of the page owning that array is
 * that they cannot disagree. A wrong count is not a crash; nothing else here
 * would catch it.
 *
 * Method: check-render's shims + a stubbed useTaskData holding a fixed five-task
 * fixture (one overdue, one due today, one in progress, one undated, one done),
 * then assert what the first paint says about it.
 *
 * It earned its place immediately: it caught `key` being spread into TaskCard
 * through a props object, which React 18 warns about and React 19 drops —
 * silently destroying list reconciliation in the triage sections.
 *
 * Usage: npm run check:mywork
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
// ── The fixture, and the page rendered over it ─────────────────────────────
const STUB_AUTH = `
import React from 'react';
const user = { id: 1, label_id: 2, name: 'John Skead', email: 'dev@cadence.local',
  role: 'Superadmin', department: 'Executive', hierarchy_level: 1, is_platform_admin: true, platform_role: 'owner' };
const label = { id: 2, name: 'Audit Test Label', settings: {} };
const value = { user, label, token: 'qa', loading: false, pagePermissions: null, impersonating: false,
  adminUser: null, canView: () => true, login: async()=>{}, logout: ()=>{}, updateLabel: ()=>{},
  impersonate: async()=>{}, enterWorkspace: async()=>{}, exitImpersonation: ()=>{} };
export const AuthProvider = ({children}) => React.createElement(React.Fragment,null,children);
export const useAuth = () => value;
export default { AuthProvider, useAuth };`;
const STUB_SOCKET = `
import React from 'react';
const value = { socket:null, connected:false, online:new Set(), on:()=>()=>{}, off:()=>{}, emit:()=>{} };
export const SocketProvider = ({children}) => React.createElement(React.Fragment,null,children);
export function useSocket(){ return value }
export default { SocketProvider, useSocket };`;

const DAY = 86400000;
// LOCAL calendar parts, never toISOString(): the page buckets tasks with
// daysUntilLocal, so a fixture built on the UTC day would call tomorrow "today"
// every evening west of Greenwich — a gate that fails after 5pm PT and passes in
// the morning. Same trap the app itself documents; it bit this file first.
const iso = (off) => {
  const d = new Date(Date.now() + off * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const TASKS = JSON.stringify([
  { id: 1, user_id: 1, description: 'Chase the Zeke Bleu W9', status: 'To Do', priority: 'Urgent', due_date: iso(-4), category: 'Finance', assignee_department: 'Executive', notes: 'hit kim' },
  { id: 2, user_id: 1, description: 'Approve NRM-2 invoice', status: 'To Do', priority: 'High', due_date: iso(0), category: 'Finance', assignee_department: 'Executive', notes: '\n  first line of the note\nsecond line' },
  { id: 3, user_id: 1, description: 'Draft Q3 recoupment statement', status: 'In Progress', priority: 'Medium', due_date: iso(9), category: 'Finance', assignee_department: 'Executive' },
  { id: 4, user_id: 1, description: 'Rewrite the onboarding email', status: 'To Do', priority: 'High', due_date: null, category: 'Marketing', assignee_department: 'Executive' },
  { id: 5, user_id: 1, description: 'Ship the artwork batch', status: 'Done', priority: 'Low', due_date: iso(-9), category: 'Release', assignee_department: 'Executive' },
]);

const STUB_TASKDATA = `
const tasks = ${TASKS};
export function midpointFor(){ return null }
export default function useTaskData(){
  return { tasks, members: [], releases: [], loading: false, error: null,
    load: async()=>{}, createTask: async()=>{}, patchTask: async()=>{}, bulkPatch: async()=>{},
    reorderTask: async()=>{}, removeTask: async()=>{}, undoLast: ()=>{}, undoDepth: 0,
    pendingEmail: null, clearPendingEmail: ()=>{} };
}`;

const stubPlugin = { name:'qa-stubs', enforce:'pre', load(id){
  if (id.endsWith('/src/context/AuthContext.jsx')) return STUB_AUTH;
  if (id.endsWith('/src/context/SocketContext.jsx')) return STUB_SOCKET;
  if (id.endsWith('/src/components/mywork/useTaskData.js')) return STUB_TASKDATA;
  return null;
}};

const vite = await createServer({ root: ROOT, configFile: ROOT+'/vite.config.js', plugins:[stubPlugin],
  server:{ middlewareMode:true, hmr:false }, appType:'custom', logLevel:'silent' });

const { MemoryRouter } = await vite.ssrLoadModule('react-router-dom');
const { ToastProvider } = await vite.ssrLoadModule('/src/context/ToastContext.jsx');
const { ThemeProvider } = await vite.ssrLoadModule('/src/context/ThemeContext.jsx');
const MyWork = (await vite.ssrLoadModule('/src/pages/MyWork.jsx')).default;

const html = renderToString(
  React.createElement(MemoryRouter, { initialEntries: ['/my-work'] },
    React.createElement(ThemeProvider, null,
      React.createElement(ToastProvider, null, React.createElement(MyWork)))));

const has = (s) => html.includes(s);
const checks = [
  ['greeting rendered',            /Good (morning|afternoon|evening)(<!-- -->)?, (<!-- -->)?John/.test(html)],
  ['3 tabs present',               has('To Do Today') && has('My Tasks') && has('My Releases')],
  ['Today tab count = 3',          /To Do Today[\s\S]{0,220}?>3</.test(html)],
  ['My Tasks count = 4 open',      /My Tasks[\s\S]{0,220}?>4</.test(html)],
  ['status pills rendered',        has('1 overdue') && has('1 due today') && has('1 in progress')],
  ['Overdue section',              has('Overdue')],
  ['Due today section',            has('Due today')],
  ['In progress section',          has('In progress')],
  ['rollover banner',              has('rolled over from previous days')],
  ['Plan your day',                has('Plan your day')],
  ['undated task is a suggestion', has('Rewrite the onboarding email')],
  ['done task NOT in triage',      !html.split('Plan your day')[0].includes('Ship the artwork batch')],
  ['tasks tab hidden, not gone',   has('class="hidden"') && has('Group')],
  ['two-column grid class',        has('xl:grid-cols-[minmax(0,1fr)_300px]')],
  // The note is the field whose VALUE is the reason to open a task; a row that
  // only says a note EXISTS is the state this replaced.
  ['note preview on a row',        has('hit kim')],
  ['no-note rows advertise it',    has('No note')],
  ['multi-line note shows line 1', has('first line of the note') && !has('second line')],
];
let bad = 0;
for (const [name, ok] of checks) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); }
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
await vite.close();
process.exit(bad ? 1 : 0);
