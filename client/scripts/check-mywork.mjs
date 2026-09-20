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
import { readFileSync } from 'node:fs';
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
const label = { id: 2, name: 'Audit Test Label', settings: {} };
// Recomputed per call so one render can be an operator and the next an ordinary
// member — the operator-only tab has to be proven ABSENT as well as present.
export const useAuth = () => ({
  user: { id: 1, label_id: 2, name: 'John Skead', email: 'dev@cadence.local',
    role: globalThis.__QA_ROLE || 'Superadmin', department: 'Executive', hierarchy_level: 1,
    is_platform_admin: globalThis.__QA_OPERATOR !== false, platform_role: 'owner' },
  label, token: 'qa', loading: false, pagePermissions: null, impersonating: false,
  adminUser: null, canView: () => true, login: async()=>{}, logout: ()=>{}, updateLabel: ()=>{},
  impersonate: async()=>{}, enterWorkspace: async()=>{}, exitImpersonation: ()=>{} });
export const AuthProvider = ({children}) => React.createElement(React.Fragment,null,children);
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

// The same page rendered as an ordinary workspace member.
globalThis.__QA_OPERATOR = false;
const memberHtml = renderToString(
  React.createElement(MemoryRouter, { initialEntries: ['/my-work'] },
    React.createElement(ThemeProvider, null,
      React.createElement(ToastProvider, null, React.createElement(MyWork)))));
globalThis.__QA_OPERATOR = true;

// And again as a plain User — neither an operator nor a team lead. The previous
// render is a Superadmin who is not an operator, which is the right test for the
// cross-workspace tab but NOT for the Team tab: a Superadmin IS a lead.
globalThis.__QA_OPERATOR = false;
globalThis.__QA_ROLE = 'User';
const plainHtml = renderToString(
  React.createElement(MemoryRouter, { initialEntries: ['/my-work'] },
    React.createElement(ThemeProvider, null,
      React.createElement(ToastProvider, null, React.createElement(MyWork)))));
globalThis.__QA_OPERATOR = true;
globalThis.__QA_ROLE = 'Superadmin';
// The split view's pane renders only once a task is picked, and SSR runs no
// effects — so the auto-select never fires and the PAGE render shows the empty
// pane. Render the pane directly instead, the same way the console's detail is
// covered below. Asserting it through the page would have been a check that
// passed on the empty state and saw nothing.
const TaskDrawer = (await vite.ssrLoadModule('/src/components/mywork/TaskDrawer.jsx')).default;
const paneTask = { id: 1, description: 'Chase the Zeke Bleu W9', status: 'To Do', priority: 'Urgent',
  category: 'Finance', due_date: null, notes: 'hit kim', user_id: 1, assignee_name: 'QA Superadmin',
  assigner_name: 'QA Superadmin', created_at: '2026-09-01T00:00:00Z' };
const paneHtml = renderToString(
  React.createElement(MemoryRouter, null,
    React.createElement(ThemeProvider, null,
      React.createElement(ToastProvider, null,
        React.createElement(TaskDrawer, {
          task: paneTask, tasks: [paneTask], members: [], releases: [], canEdit: true,
          canAssign: false, canUnassign: false, variant: 'pane',
          onClose: () => {}, onPatch: () => {}, onDelete: () => {},
        })))));
const pHas = (x) => paneHtml.includes(x);
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
  // The personal default is the split view: a list with the task you are reading
  // beside it. If this regresses to the Board, /my-work silently stops looking
  // like the page it was asked to look like.
  ['default view is Split',        has('Split') && has('lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]')],
  ['no overlay drawer in split',   !has('fixed inset-0 z-[60]')],
  // An operator standing inside a workspace can see every workspace's tasks from
  // here. A member must not even see the tab — it would render a cross-tenant
  // surface they are not allowed to load.
  ['operator gets All workspaces',  has('All workspaces')],
  ['member does NOT',               !memberHtml.includes('All workspaces')],
  // Team Work is a tab here now, not a page. A lead must get it; a plain member
  // must not even see it, since teamFilter would 403 the surface behind it.
  // The label is a bare text node between the icon and the (absent) badge, so
  // this is the exact shape it renders as.
  ['lead gets the Team tab',        has('</svg>Team</button>')],
  ['a plain member does not',       !plainHtml.includes('</svg>Team</button>')],
  // The pane, rendered for real:
  ['pane: title is editable',      /<input[^>]+aria-label="Task name"/.test(paneHtml)],
  ['pane: no duplicate Task field', !/<label class="label">Task<\/label>/.test(paneHtml)],
  ['pane: note is the body',       pHas('hit kim') && !/<label class="label">Note<\/label>/.test(paneHtml)],
  ['pane: fields still present',   pHas('Status') && pHas('Priority') && pHas('Due date')],
  ['pane: is not an overlay',      !/fixed inset-0/.test(paneHtml) && !/aria-modal/.test(paneHtml)],
  // Polish, held as facts rather than left to a screenshot:
  // · an empty due-bucket is a dead section in a list (five of them above one task),
  // · the title was rendered as a heading AND a labelled field, the same string twice,
  // · and a personal page put YOUR name on every row of your own list.
  ['no empty group sections',      !has('>Empty<')],
  ['no self-assignee on my rows',  !has('QA Superadmin')],
  ['two-column grid class',        has('xl:grid-cols-[minmax(0,1fr)_300px]')],
  // The note is the field whose VALUE is the reason to open a task; a row that
  // only says a note EXISTS is the state this replaced.
  ['note preview on a row',        has('hit kim')],
  ['no-note rows advertise it',    has('No note')],
  ['multi-line note shows line 1', has('first line of the note') && !has('second line')],
];
// noteLine is PURE and now shared by three surfaces (task card, the Table
// view's Note column, and the operator console, which has no drawer). Asserted
// directly rather than only through the rendered page, because the console's
// use of it cannot be reached by an SSR first paint.
const { noteLine } = await vite.ssrLoadModule('/src/components/mywork/taskFields.js');
checks.push(
  ['noteLine: first non-empty line', noteLine('\n\n  hit kim \nsecond') === 'hit kim'],
  ['noteLine: empty in, empty out',  noteLine(null) === '' && noteLine('') === '' && noteLine('   ') === ''],
  ['noteLine: caps long lines',      noteLine('x'.repeat(200)).length === 121 && noteLine('x'.repeat(200)).endsWith('…')],
  ['noteLine: single line intact',   noteLine('just one line') === 'just one line'],
);

// The operator console's detail pane. Exported and rendered with props because
// that page fetches in an effect, and SSR runs no effects — rendering the page
// itself would only ever prove its skeleton, which is what let a missing note
// feature ship unnoticed once already.
const { TaskDetail } = await vite.ssrLoadModule('/src/pages/PlatformMyWork.jsx');
const detailHtml = renderToString(
  React.createElement(MemoryRouter, null,
    React.createElement(ThemeProvider, null,
      React.createElement(ToastProvider, null,
        React.createElement(TaskDetail, {
          task: { id: 1, description: '2025 taxes', status: 'To Do', priority: 'Medium',
                  category: 'General', due_date: null, notes: 'hit kim', label_id: 2,
                  label_name: 'The Nest', label_status: 'active' },
          editable: true, busy: false, draft: 'hit kim',
          onDraft: () => {}, onDraftBlur: () => {}, onPatch: () => {}, onDelete: () => {},
          onClose: () => {}, workspace: { id: 2, name: 'The Nest' }, color: '#888', tag: 'TN',
        })))));
const dHas = (x) => detailHtml.includes(x);
checks.push(
  ['console pane: title',        dHas('2025 taxes')],
  ['console pane: note body',    dHas('hit kim')],
  ['console pane: meta row',     dHas('To Do') && dHas('Medium') && dHas('General')],
  ['console pane: workspace',    dHas('The Nest') && dHas('TN')],
);

// The assignee picker: the console's one cross-tenant write. Rendered for both
// a task the operator holds and one a tenant member now owns, since the two
// states differ (an owned task shows "Me" selected; a delegated one must show
// the PERSON, or the control would read as if nobody held it).
const detailAssigned = renderToString(
  React.createElement(MemoryRouter, null,
    React.createElement(ThemeProvider, null,
      React.createElement(ToastProvider, null,
        React.createElement(TaskDetail, {
          task: { id: 2, description: 'Send the Q3 statement', status: 'To Do', priority: 'High',
                  category: null, due_date: null, notes: null, label_id: 2, user_id: 9,
                  assignee_name: 'Milo Marketer', label_name: 'The Nest', label_status: 'active' },
          editable: false, busy: false, draft: '',
          onDraft: () => {}, onDraftBlur: () => {}, onPatch: () => {}, onDelete: () => {},
          onClose: () => {}, workspace: { id: 2, name: 'The Nest' }, color: '#888', tag: 'TN',
          roster: [{ id: 9, name: 'Milo Marketer', department: 'Marketing' }],
          onAssign: () => {},
        })))));
checks.push(
  ['assignee picker renders',    detailAssigned.includes('Assigned to')],
  ['picker lists the roster',    detailAssigned.includes('Milo Marketer')],
  ['delegated shows the holder', /<option[^>]*value="9"[^>]*selected/.test(detailAssigned) || detailAssigned.includes('waiting on them')],
  ['no picker without onAssign', !detailHtml.includes('Assigned to')],
);

// ── the client's permission mirror must match server/routes/tasks.js ──────
// canMutateTask refuses an Approver on an Admin/Superadmin's task even inside
// their own department (a privilege inversion). The client copy was missing
// that half, so a lead was shown a full set of edit controls that all 403'd —
// and the SQL behind PATCH /tasks/bulk was missing it too, which let the same
// lead edit and even take ownership of an admin's task.
{
  const { canEditTaskFor, dayFromToday } = await vite.ssrLoadModule('/src/components/mywork/taskFields.js');
  const lead = { id: 8, role: 'Approver', department: 'Marketing' };
  const admin = { id: 1, role: 'Admin', department: 'Marketing' };
  const inDept = (role, userId = 99) => ({ user_id: userId, assignee_department: 'Marketing', assignee_role: role });

  checks.push(
    ['lead cannot edit an Admin-owned task',        canEditTaskFor(inDept('Admin'), lead) === false],
    ['lead cannot edit a Superadmin-owned task',    canEditTaskFor(inDept('Superadmin'), lead) === false],
    ['lead CAN edit a member-owned task in dept',   canEditTaskFor(inDept('User'), lead) === true],
    ['lead CAN edit their own task',                canEditTaskFor(inDept('Approver', 8), lead) === true],
    ['lead cannot edit another department',         canEditTaskFor({ user_id: 99, assignee_department: 'Finance', assignee_role: 'User' }, lead) === false],
    ['an Admin can edit anyone',                    canEditTaskFor(inDept('Superadmin'), admin) === true],
    // The rule needs assignee_role, so TASK_SELECT has to carry it. Without the
    // column the mirror silently falls open on exactly the case it guards.
    ['the server projection carries assignee_role',
      readFileSync(new URL('../../server/routes/tasks.js', import.meta.url), 'utf8').includes('u.role AS assignee_role')],
    ['the bulk SQL refuses admin-owned rows too',
      /u\.role NOT IN \('Superadmin', 'Admin'\)/.test(readFileSync(new URL('../../server/routes/tasks.js', import.meta.url), 'utf8'))],
  );

  // "Tomorrow" is a CALENDAR day, not +24h — the two differ across a DST shift.
  const t = new Date();
  const expected = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  checks.push(['dayFromToday(1) is the next calendar day',
    dayFromToday(1) === `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}`]);
}

let bad = 0;
for (const [name, ok] of checks) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); }
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
await vite.close();
process.exit(bad ? 1 : 0);
