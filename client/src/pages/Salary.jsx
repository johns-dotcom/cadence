// Salary — the payroll roster and its monthly paid/unpaid ledger.
//
// A standalone roster, deliberately NOT the users table: people on payroll are not
// necessarily app accounts, and app accounts are not necessarily on payroll.
//
// Two structural things this page has to get right:
//  · CURRENCY. Employees carry their own currency, so a single "$12,400" total is a
//    lie the moment two currencies are in play. Totals are computed and rendered PER
//    CURRENCY, never summed across.
//  · Marking paid is an AUDITED action. The toggle writes salary_payment_history on
//    both directions, so unmarking leaves a trail instead of erasing one.

import { useEffect, useMemo, useState } from 'react'
import { Plus, Check, ChevronLeft, ChevronRight, X, History, Pencil, Trash2, Users } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useToast } from '../context/ToastContext'
import { DEPARTMENTS, CURRENCIES } from '../constants'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Intl, not a hand-rolled `$` prefix: EUR/GBP/JPY all place and shape their symbol
// differently, and JPY has no minor unit at all.
const money = (n, c = 'USD') => {
  const v = Number(n || 0)
  try {
    return v.toLocaleString(undefined, { style: 'currency', currency: c || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } catch {
    return `${c || ''} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
  }
}

const NO_DEPT = '—'
const BLANK_FORM = { name: '', department: '', monthly_amount: '', currency: 'USD' }

function StatCard({ label, children, sub }) {
  return (
    <div className="card px-5 py-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">{label}</p>
      <div className="mt-1 leading-none">{children}</div>
      {sub && <p className="text-[10px] text-ink-muted mt-1.5">{sub}</p>}
    </div>
  )
}

// One line per currency present. Rendering three lines in a stat card is honest;
// adding EUR to USD and printing a dollar sign is not.
function MoneyLines({ byCurrency, tone }) {
  const entries = Object.entries(byCurrency).filter(([, v]) => v !== 0)
  if (!entries.length) return <p className={`text-xl font-bold ${tone || 'text-ink'}`}>{money(0)}</p>
  return (
    <div className="space-y-0.5">
      {entries.map(([c, v]) => (
        <p key={c} className={`text-xl font-bold ${tone || 'text-ink'}`}>{money(v, c)}</p>
      ))}
    </div>
  )
}

export default function Salary() {
  const { toast } = useToast()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)
  const [history, setHistory] = useState(null)
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState(BLANK_FORM)
  const [busyId, setBusyId] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)

  const isThisMonth = month === now.getMonth() + 1 && year === now.getFullYear()

  const load = () => {
    setLoading(true)
    api.get('/salary', { params: { month, year } })
      .then(r => setEmployees(r.data.data.employees || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [month, year])

  // History is MONTH-SCOPED, so it has to refetch when the month does — a cached
  // global list left the card showing January's actions above February's table.
  useEffect(() => {
    if (history === null) return
    api.get('/salary/history', { params: { month, year } }).then(r => setHistory(r.data.data || [])).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year])

  const toggleHistory = async () => {
    if (history) { setHistory(null); return }
    try { const { data } = await api.get('/salary/history', { params: { month, year } }); setHistory(data.data || []) }
    catch { toast('Failed to load history', 'error') }
  }

  const prev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1) }
  const next = () => { if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1) }
  const thisMonth = () => { setMonth(now.getMonth() + 1); setYear(now.getFullYear()) }

  const addEmployee = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { toast('Name is required', 'error'); return }
    try {
      await api.post('/salary/employees', form)
      toast('Employee added'); setShowForm(false); setForm(BLANK_FORM); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const startEdit = (emp) => {
    setEditId(emp.id)
    setEditForm({
      name: emp.name || '',
      department: emp.department || '',
      monthly_amount: emp.monthly_amount ?? '',
      currency: emp.currency || 'USD',
    })
  }

  const saveEdit = async () => {
    if (!editForm.name.trim()) { toast('Name cannot be blank', 'error'); return }
    setBusyId(editId)
    try {
      const { data } = await api.patch(`/salary/employees/${editId}`, editForm)
      // Trust the server row, but keep the JOIN-only fields (paid / paid_at) the
      // PATCH response doesn't carry — spreading it raw would blank the paid pill.
      setEmployees(es => es.map(e => (e.id === editId ? { ...e, ...data.data } : e)))
      setEditId(null)
      toast('Employee updated')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusyId(null) }
  }

  const removeEmployee = async (emp) => {
    setConfirmRemove(null)
    setBusyId(emp.id)
    try {
      // Soft delete server-side — their payment history survives.
      await api.delete(`/salary/employees/${emp.id}`)
      setEmployees(es => es.filter(e => e.id !== emp.id))
      toast(`${emp.name} removed from payroll`)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusyId(null) }
  }

  const togglePaid = async (emp) => {
    if (busyId === emp.id) return   // a double-click used to fire two PUTs
    setBusyId(emp.id)
    const paid = !emp.paid
    try {
      const { data } = await api.put(`/salary/${emp.id}/pay`, { month, year, paid })
      // Patch locally instead of a full reload: reloading re-rendered the whole
      // table and threw away scroll position for a one-cell change.
      setEmployees(es => es.map(e => (e.id === emp.id ? { ...e, paid: data.data.paid, paid_at: data.data.paid_at } : e)))
      if (history) api.get('/salary/history', { params: { month, year } }).then(r => setHistory(r.data.data || [])).catch(() => {})
    } catch { toast('Failed', 'error') }
    finally { setBusyId(null) }
  }

  // ── Derived: per-currency totals and department grouping ─────────────────
  const totals = useMemo(() => {
    const due = {}
    const paid = {}
    for (const e of employees) {
      const c = e.currency || 'USD'
      const amt = Number(e.monthly_amount || 0)
      due[c] = (due[c] || 0) + amt
      if (e.paid) paid[c] = (paid[c] || 0) + amt
    }
    const remaining = Object.fromEntries(Object.keys(due).map(c => [c, due[c] - (paid[c] || 0)]))
    return { due, paid, remaining }
  }, [employees])

  const paidCount = employees.filter(e => e.paid).length

  const groups = useMemo(() => {
    const by = new Map()
    for (const e of employees) {
      const k = e.department || NO_DEPT
      if (!by.has(k)) by.set(k, [])
      by.get(k).push(e)
    }
    // Known departments in their canonical order, then anything a workspace typed
    // itself, then the no-department bucket last.
    const known = DEPARTMENTS.filter(d => by.has(d))
    const extra = [...by.keys()].filter(k => k !== NO_DEPT && !DEPARTMENTS.includes(k)).sort()
    const order = [...known, ...extra, ...(by.has(NO_DEPT) ? [NO_DEPT] : [])]
    return order.map(k => {
      const rows = by.get(k)
      const subtotal = {}
      for (const e of rows) {
        const c = e.currency || 'USD'
        subtotal[c] = (subtotal[c] || 0) + Number(e.monthly_amount || 0)
      }
      return { key: k, rows, subtotal, paid: rows.filter(e => e.paid).length }
    })
  }, [employees])

  const editing = (id) => editId === id

  return (
    <div>
      <PageHeader
        title="Salary"
        subtitle="Monthly payroll for this workspace"
        action={
          <div className="flex items-center gap-2">
            <button onClick={toggleHistory} className="btn-secondary"><History size={15} /> {history ? 'Hide history' : 'History'}</button>
            <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add employee</button>
          </div>
        }
      />

      <div className="flex items-center gap-2 mb-5">
        <button onClick={prev} aria-label="Previous month" className="p-1.5 border border-rule rounded-lg text-ink-muted hover:text-ink"><ChevronLeft size={16} /></button>
        <span className="text-sm font-bold text-ink min-w-[140px] text-center">{MONTHS[month - 1]} {year}</span>
        <button onClick={next} aria-label="Next month" className="p-1.5 border border-rule rounded-lg text-ink-muted hover:text-ink"><ChevronRight size={16} /></button>
        {/* Six clicks back through the year and no way home was the actual cost of
            not having this. */}
        {!isThisMonth && (
          <button onClick={thisMonth} className="text-xs font-semibold text-brand-ink hover:underline ml-1">This month</button>
        )}
      </div>

      {loading ? <Skeleton.StatCards count={4} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total payroll"><MoneyLines byCurrency={totals.due} /></StatCard>
          <StatCard label="Paid out"><MoneyLines byCurrency={totals.paid} tone="text-success" /></StatCard>
          <StatCard label="Remaining"><MoneyLines byCurrency={totals.remaining} tone="text-warning" /></StatCard>
          <StatCard label="Employees" sub={`${paidCount} of ${employees.length} paid`}>
            <p className="text-xl font-bold text-ink inline-flex items-center gap-1.5">
              <Users size={16} className="text-ink-faint" aria-hidden="true" /> {employees.length}
            </p>
          </StatCard>
        </div>
      )}

      {showForm && (
        <form onSubmit={addEmployee} className="card p-4 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="label">Name</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></div>
          <div>
            <label className="label">Department</label>
            {/* A datalist, not a select: payroll employees are not app users, so the
                DEPARTMENTS enum is a suggestion here, not the permission boundary it
                is on /team. "Touring crew" has to be typeable. */}
            <input className="input" list="salary-departments" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
            <datalist id="salary-departments">{DEPARTMENTS.map(d => <option key={d} value={d} />)}</datalist>
          </div>
          <div><label className="label">Monthly</label><input type="number" step="0.01" min="0" className="input" value={form.monthly_amount} onChange={e => setForm(f => ({ ...f, monthly_amount: e.target.value }))} /></div>
          <div><label className="label">Currency</label><select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="col-span-2 sm:col-span-4 flex gap-2">
            <button className="btn-primary">Save employee</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {history && (
        <div className="card p-4 mb-6">
          <h2 className="text-sm font-bold text-ink mb-3">Payment history · {MONTHS[month - 1]} {year}</h2>
          {history.length === 0 ? <p className="text-sm text-ink-muted">Nothing recorded for this month.</p> : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between gap-3 text-sm py-1 border-b border-divider last:border-0">
                  <span className="text-ink min-w-0 truncate">
                    {/* Both directions are recorded, and they are opposite facts — a
                        single neutral row for "marked paid" and "reversed" would be
                        worse than no history. */}
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full mr-1.5 ${
                      h.action === 'marked_paid' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-600'
                    }`}>
                      {h.action === 'marked_paid' ? 'Paid' : 'Unpaid'}
                    </span>
                    {h.employee}
                  </span>
                  <span className="text-[11px] text-ink-muted flex-shrink-0">
                    {h.performed_by || '—'} · {h.performed_at ? new Date(h.performed_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-4"><Skeleton.Block h="h-40" /><Skeleton.Block h="h-40" /></div>
      ) : employees.length === 0 ? (
        <div className="card p-10 text-center"><p className="text-sm text-ink-muted">No employees on payroll yet.</p></div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => (
            <div key={g.key} className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-elev border-b border-divider">
                <h2 className="text-xs font-bold text-ink uppercase tracking-wide">{g.key}</h2>
                <div className="flex items-center gap-3 text-[11px] text-ink-muted">
                  <span>{g.paid}/{g.rows.length} paid</span>
                  <span className="font-semibold text-ink">
                    {Object.entries(g.subtotal).map(([c, v]) => money(v, c)).join(' + ')}
                  </span>
                </div>
              </div>

              <table className="w-full text-sm">
                <tbody className="divide-y divide-divider">
                  {g.rows.map(e => editing(e.id) ? (
                    <tr key={e.id} className="bg-brand-500/[0.06]">
                      <td colSpan={4} className="px-4 py-3">
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                          <div><label className="label">Name</label><input className="input" value={editForm.name} onChange={ev => setEditForm(f => ({ ...f, name: ev.target.value }))} autoFocus /></div>
                          <div>
                            <label className="label">Department</label>
                            {/* Own id — two <datalist>s sharing one id means the browser
                                binds both inputs to whichever appears first in the DOM. */}
                            <input className="input" list="salary-departments-edit" value={editForm.department} onChange={ev => setEditForm(f => ({ ...f, department: ev.target.value }))} />
                            <datalist id="salary-departments-edit">{DEPARTMENTS.map(d => <option key={d} value={d} />)}</datalist>
                          </div>
                          <div><label className="label">Monthly</label><input type="number" step="0.01" min="0" className="input" value={editForm.monthly_amount} onChange={ev => setEditForm(f => ({ ...f, monthly_amount: ev.target.value }))} /></div>
                          <div><label className="label">Currency</label><select className="input" value={editForm.currency} onChange={ev => setEditForm(f => ({ ...f, currency: ev.target.value }))}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
                          <div className="flex gap-2">
                            <button onClick={saveEdit} disabled={busyId === e.id} className="btn-primary !py-1.5 text-xs flex-1">{busyId === e.id ? 'Saving…' : 'Save'}</button>
                            <button onClick={() => setEditId(null)} className="btn-secondary !py-1.5 text-xs">Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={e.id} className="hover:bg-elev transition group">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{e.name}</p>
                        {/* Paid metadata was on the row in boom and the server already
                            returns paid_at — showing only a pill threw away the "when". */}
                        {e.paid && e.paid_at && (
                          <p className="text-[10px] text-ink-muted">Paid {new Date(e.paid_at).toLocaleDateString()}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-ink whitespace-nowrap">{money(e.monthly_amount, e.currency)}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => togglePaid(e)}
                          disabled={busyId === e.id}
                          aria-pressed={!!e.paid}
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition disabled:opacity-60
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
                            ${e.paid
                              ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25'
                              // Unpaid is a STATE, and a red one — the previous gray
                              // "Mark paid" labelled the action instead, so an unpaid
                              // month had no alarm colour anywhere on the page.
                              : 'bg-red-500/15 text-red-600 hover:bg-red-500/25'}`}
                        >
                          {busyId === e.id ? '…' : e.paid ? <><Check size={12} /> Paid</> : <><X size={12} /> Unpaid</>}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap w-20">
                        <button onClick={() => startEdit(e)} className="text-ink-faint hover:text-ink opacity-0 group-hover:opacity-100 focus:opacity-100 transition mr-2 rounded" title="Edit" aria-label={`Edit ${e.name}`}>
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setConfirmRemove(e)} className="text-ink-faint hover:text-danger opacity-0 group-hover:opacity-100 focus:opacity-100 transition rounded" title="Remove" aria-label={`Remove ${e.name}`}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => removeEmployee(confirmRemove)}
        title="Remove from payroll"
        message={`${confirmRemove?.name || 'This employee'} will stop appearing on the roster. Their payment history is kept.`}
        confirmLabel="Remove"
      />
    </div>
  )
}
