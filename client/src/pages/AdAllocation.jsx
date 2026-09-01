// Allocate Advertising — putting an artist's name on ad-platform spend.
//
// ── The problem ──
// Ad-platform charges carry no artist evidence at all: the descriptors are
// merchant ids repeated on every charge ("PURCHASE 0724 FACEBK *F4EE6X5GP2").
// There is nothing on the charge to attribute FROM. Marketing spend, by
// contrast, arrives as invoices that name the work.
//
// ── The mechanism ──
// A campaign is the basis, and the write is a REAL split family whose slices are
// marked reviewed and recoupable — the supported way onto the recoupment
// surfaces (lib/recoupments.js recoupBaseSql). An allocation that wrote to a
// side table would be invisible to Recoupments, the artist spend sheets and the
// recoupment audit, which is exactly why a ledger-external ad pool goes unused.
//
// ── Bank is the money, Ads Manager is the basis ──
// Only real charges are ever apportioned. An export supplies proportions and
// nothing else, so there is no reconciliation remainder to park anywhere.
//
// Data comes from three endpoints and this page derives no money of its own:
//   GET  /reports/ad-months    which months hold pool, oldest first
//   GET  /reports/ad-charges   one month: its charges, allocations, campaigns
//   POST /reports/ad-allocate  dry_run for the preview, then the same call to write

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Upload, Info, Settings2, Trash2 } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import ChargeTable from '../components/adalloc/ChargeTable'
import AllocatePanel from '../components/adalloc/AllocatePanel'
import ImportMapper from '../components/adalloc/ImportMapper'
import { Modal, Button, ConfirmDialog } from '../components/ui'
import useFocusRefetch from '../hooks/useFocusRefetch'

const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const usd0 = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthLabel = (m) => (/^\d{4}-\d{2}$/.test(String(m || '')) ? `${MONTHS[Number(m.slice(5))]} ${m.slice(0, 4)}` : String(m || ''))

export default function AdAllocation() {
  // State first, and above everything that derives from it.
  const [months, setMonths] = useState(null)
  const [month, setMonth] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [pendingReq, setPendingReq] = useState(null)
  const [panelErr, setPanelErr] = useState('')
  const [mode, setMode] = useState('one')       // 'one' | 'import'
  const [newCamp, setNewCamp] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [undoing, setUndoing] = useState(null)
  const [flash, setFlash] = useState('')

  const loadMonths = useCallback(() => api.get('/reports/ad-months')
    .then((r) => { const list = r.data?.data?.months || []; setMonths(list); return list })
    .catch((e) => { setErr(e?.response?.data?.error || e.message); setMonths([]); return [] }), [])

  // Which months hold pool. Loaded once; the page opens on the OLDEST with money
  // in it, because a backlog is worked oldest-first.
  useEffect(() => {
    let live = true
    loadMonths().then((list) => {
      if (!live) return
      setMonth((m) => m || (list.length ? list[0].month : new Date().toISOString().slice(0, 7)))
    })
    return () => { live = false }
  }, [loadMonths])

  const load = useCallback(async (m, { silent } = {}) => {
    if (!m) return
    if (!silent) setLoading(true)
    setErr('')
    try {
      const r = await api.get(`/reports/ad-charges?month=${m}`)
      setData(r.data?.data || null)
    } catch (e) {
      setErr(e?.response?.data?.error || e.message)
      setData(null)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(month) }, [month, load])
  useFocusRefetch(() => load(month, { silent: true }))

  const charges = data?.charges || []
  const campaigns = data?.campaigns || []
  const openDollars = (data?.allocatable_cents || 0) / 100
  const blockedDollars = ((data?.open_cents || 0) - (data?.allocatable_cents || 0)) / 100
  const allocatedDollars = (data?.allocated_cents || 0) / 100

  const monthIdx = useMemo(() => (months || []).findIndex((x) => x.month === month), [months, month])
  const step = (d) => {
    const list = months || []
    const i = monthIdx + d
    if (i >= 0 && i < list.length) setMonth(list[i].month)
  }
  const clearPreview = () => { setPreview(null); setPendingReq(null); setPanelErr('') }

  const doPreview = async (payload) => {
    setBusy(true); setPanelErr(''); setPreview(null)
    try {
      const body = { month, dry_run: true, ...payload }
      const r = await api.post('/reports/ad-allocate', body)
      setPreview(r.data?.data || null)
      setPendingReq(body)
    } catch (e) { setPanelErr(e?.response?.data?.error || e.message) } finally { setBusy(false) }
  }

  const doApply = async () => {
    if (!pendingReq) return
    setBusy(true); setPanelErr('')
    try {
      const { dry_run, ...write } = pendingReq // eslint-disable-line no-unused-vars
      const r = await api.post('/reports/ad-allocate', write)
      const w = r.data?.data
      setFlash(`Allocated ${usd(w.total)} across ${w.per_charge.length} charge${w.per_charge.length === 1 ? '' : 's'} — `
        + `${w.written.slices + w.written.charges} ledger row(s) written, marked reviewed and recoupable.`)
      clearPreview()
      setMode('one')
      await load(month)
      loadMonths()   // the strip's figures came from the same derivation and moved
    } catch (e) { setPanelErr(e?.response?.data?.error || e.message) } finally { setBusy(false) }
  }

  const undo = async () => {
    const a = undoing
    setUndoing(null)
    if (!a) return
    setBusy(true)
    try {
      const r = await api.delete(`/reports/ad-allocate/${a.expense_id}`)
      setFlash(`Returned ${usd(a.cents / 100)} to the pool — ${r.data?.data?.outcome}.`)
      await load(month)
      loadMonths()
    } catch (e) { setErr(e?.response?.data?.error || e.message) } finally { setBusy(false) }
  }

  if (months === null) return <div><Skeleton.PageHeader /><Skeleton.Table /></div>

  const noRules = data && data.rule_count === 0

  return (
    <div>
      <PageHeader
        title="Allocate Advertising"
        subtitle="Ad-platform charges name nobody. Put a campaign — and so an artist — behind the money."
        action={
          <div className="flex items-center gap-1">
            <button onClick={() => setRulesOpen(true)} className="btn-secondary mr-1"><Settings2 size={14} /> Pool rules</button>
            <button onClick={() => step(-1)} disabled={monthIdx <= 0}
              className="p-1.5 rounded-lg border border-rule disabled:opacity-30 hover:bg-elev" aria-label="Previous month"><ChevronLeft size={14} /></button>
            <select value={month} onChange={(e) => { setMonth(e.target.value); clearPreview() }} className="input !py-1.5 !text-[13px] !w-auto">
              {(months.some((x) => x.month === month) ? months : [{ month, usd: 0 }, ...months]).map((m) => (
                <option key={m.month} value={m.month}>{monthLabel(m.month)}{m.usd ? ` — ${usd0(m.usd)}` : ''}</option>
              ))}
            </select>
            <button onClick={() => step(1)} disabled={monthIdx < 0 || monthIdx >= months.length - 1}
              className="p-1.5 rounded-lg border border-rule disabled:opacity-30 hover:bg-elev" aria-label="Next month"><ChevronRight size={14} /></button>
          </div>
        }
      />

      {/* The backlog at a glance. Oldest first, and the whole point of showing it
          is that it is meant to shrink. */}
      {months.length > 1 && (
        <div className="flex items-end gap-1 mb-4 overflow-x-auto pb-1">
          {months.map((m) => {
            const max = Math.max(...months.map((x) => x.usd)) || 1
            const on = m.month === month
            return (
              <button key={m.month} onClick={() => { setMonth(m.month); clearPreview() }}
                title={`${monthLabel(m.month)} — ${usd(m.usd)} unallocated over ${m.charges} charges`}
                className="group flex-shrink-0 w-14 flex flex-col items-center gap-1">
                <span className={`text-[10px] tabular-nums ${on ? 'text-ink font-bold' : 'text-ink-faint'}`}>
                  {m.usd >= 1000 ? `${Math.round(m.usd / 1000)}k` : Math.round(m.usd)}
                </span>
                <span className={`w-full rounded-t ${on ? 'bg-brand-500' : 'bg-elev group-hover:bg-brand-500/30'}`}
                  style={{ height: `${Math.max(3, Math.round((m.usd / max) * 44))}px` }} />
                <span className={`text-[10px] ${on ? 'text-ink font-semibold' : 'text-ink-faint'}`}>{m.month.slice(5)}</span>
              </button>
            )
          })}
        </div>
      )}

      {err && <div className="card p-3 border-l-4 border-l-danger text-sm text-danger mb-3">{err}</div>}
      {flash && (
        <div className="card p-3 border-l-4 border-l-emerald-500 text-sm text-ink mb-3 flex flex-wrap items-start gap-2">
          <span className="flex-1">{flash}</span>
          <Link to="/recoupments" className="text-[12px] font-semibold text-brand-ink hover:underline">See it on Recoupments</Link>
          <button onClick={() => setFlash('')} className="text-ink-faint hover:text-ink" aria-label="Dismiss">&times;</button>
        </div>
      )}

      {noRules && (
        <div className="card p-4 mb-3 border-l-4 border-l-amber-400">
          <p className="text-sm text-ink font-semibold">This workspace has no ad-pool rules yet, so the pool is empty.</p>
          <p className="text-[12px] text-ink-muted mt-1">
            The pool is <strong>declared, not guessed</strong>: name the vendors (or categories) whose spend bills the
            label rather than a release — Meta, TikTok, Google. Only their unattributed charges become allocatable, and
            they leave the &ldquo;names an artist&rdquo; coverage figure on Artist Campaigns, which is the honest reading.
          </p>
          <button onClick={() => setRulesOpen(true)} className="btn-primary !py-1.5 text-[13px] mt-2"><Settings2 size={14} /> Add pool rules</button>
        </div>
      )}

      {loading ? <Skeleton.Table /> : !data ? null : (
        <>
          {/* Three numbers, and they add up to the month. Stated rather than
              implied: a summary that does not reconcile to its own list is how a
              page starts lying. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] mb-3">
            <span className="text-ink-muted"><strong className="text-ink tabular-nums">{usd(openDollars)}</strong> unallocated</span>
            {blockedDollars > 0.005 && (
              <span className="text-warning tabular-nums" title="In charges this page cannot restructure — listed below with the reason">
                {usd(blockedDollars)} needs sorting out by hand
              </span>
            )}
            <span className="text-ink-muted"><strong className="text-ink tabular-nums">{usd(allocatedDollars)}</strong> allocated</span>
            <span className="text-ink-faint">{charges.length} charges</span>
            {Math.abs((data.open_usd || 0) - (data.pool_usd || 0)) > 0.02 && (
              <span className="text-danger text-[12px]" title="The listing and the P&L should agree exactly">
                listing {usd(data.open_usd)} vs report {usd(data.pool_usd)}
              </span>
            )}
          </div>

          {/* CAMPAIGNS */}
          <div className="card mb-3">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-divider">
              <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">Campaigns in {monthLabel(month)}</span>
              <span className="ml-auto flex items-center gap-3">
                <button onClick={() => { setMode('import'); clearPreview() }} className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-ink hover:underline">
                  <Upload size={12} /> Import CSV
                </button>
                <button onClick={() => setNewCamp(true)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-ink hover:underline">
                  <Plus size={12} /> New campaign
                </button>
              </span>
            </div>
            {campaigns.length === 0 ? (
              <div className="px-3 py-6 text-center text-[13px] text-ink-muted">
                No campaigns for this month yet. Create one — it is what gives the money a name.
              </div>
            ) : (
              <div className="divide-y divide-divider">
                {campaigns.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
                    <span className="font-semibold text-ink">{c.artist || <span className="text-danger">no artist</span>}</span>
                    {c.song && <span className="text-ink-faint">· {c.song}</span>}
                    <span className="text-ink-muted truncate">{c.name}</span>
                    <span className="text-[11px] text-ink-faint uppercase tracking-wide">{c.platform}</span>
                    <span className="ml-auto text-ink-faint tabular-nums">{c.planned_budget ? `planned ${usd0(c.planned_budget)}` : ''}</span>
                    <span className="w-28 text-right tabular-nums font-medium text-ink">
                      {c.allocated_cents ? usd(c.allocated_cents / 100) : <span className="text-ink-faint">—</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {newCamp && <NewCampaignModal month={month} onClose={() => setNewCamp(false)} onCreated={() => { setNewCamp(false); load(month) }} />}

          {/* ALLOCATE */}
          <div className="mb-3">
            {mode === 'import' ? (
              <ImportMapper campaigns={campaigns} platform="Facebook" busy={busy}
                onCancel={() => { setMode('one'); clearPreview() }}
                onPreview={(allocations) => doPreview({ allocations, proportional: true })} />
            ) : (
              <AllocatePanel campaigns={campaigns} openDollars={openDollars} busy={busy}
                preview={preview} error={panelErr} onPreview={doPreview} onApply={doApply} onCancel={clearPreview} />
            )}
            {mode === 'import' && (panelErr || preview) && (
              <div className="card p-3 mt-2">
                {panelErr && <div className="text-[12px] text-danger bg-rose-500/10 border-l-2 border-l-danger px-2.5 py-1.5 mb-2">{panelErr}</div>}
                {preview && (
                  <>
                    <div className="text-[12px] text-ink-muted mb-2">
                      <strong className="text-ink">{usd(preview.total)}</strong> of real charges, split by the file&rsquo;s
                      proportions across {preview.per_campaign.length} campaigns.
                    </div>
                    <div className="rounded-lg border border-rule overflow-hidden mb-2.5">
                      {preview.per_campaign.map((c) => (
                        <div key={c.campaign_id} className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] border-b border-divider last:border-0">
                          <span className="font-semibold text-ink">{c.artist}</span>
                          {c.song && <span className="text-ink-faint">· {c.song}</span>}
                          <span className="text-ink-muted truncate">{c.campaign_name}</span>
                          <span className="ml-auto tabular-nums font-medium text-ink">{usd(c.amount)}</span>
                          <span className="tabular-nums text-ink-faint w-20 text-right">{c.charges} charges</span>
                        </div>
                      ))}
                    </div>
                    <button onClick={doApply} disabled={busy} className="btn-primary !py-1.5 text-[13px] disabled:opacity-40">
                      {busy ? 'Writing…' : 'Apply — write the ledger splits'}
                    </button>
                    <button onClick={clearPreview} className="text-[12px] text-ink-faint hover:text-ink ml-2">Cancel</button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* CHARGES */}
          <div className="card">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-divider">
              <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">Charges — what the bank paid</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-ink-faint">
                <Info size={11} /> allocated slices are recoupable ledger rows
              </span>
            </div>
            <ChargeTable charges={charges} highlight={(preview?.per_charge || []).map((c) => c.root_id)} onUndo={setUndoing} />
          </div>
        </>
      )}

      <ConfirmDialog open={!!undoing} onClose={() => setUndoing(null)} onConfirm={undo}
        title="Return this slice to the pool?"
        confirmLabel="Return it" variant="secondary" busy={busy}
        message={undoing ? `${usd(undoing.cents / 100)} allocated to ${undoing.artist} goes back to belonging to nobody. The charge total does not change.` : ''} />

      {rulesOpen && <PoolRulesModal onClose={() => setRulesOpen(false)} onChanged={() => { load(month); loadMonths() }} />}
    </div>
  )
}

// A create form for the existing POST /campaigns, not a surface of its own.
function NewCampaignModal({ month, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', platform: 'Facebook', artist_id: '', release_id: '', planned_budget: '' })
  const [artists, setArtists] = useState([])
  const [allReleases, setAllReleases] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    api.get('/artists').then((r) => setArtists(r.data?.data || [])).catch(() => {})
    api.get('/releases?archived=any&in_catalog=any').then((r) => setAllReleases(r.data?.data || [])).catch(() => {})
  }, [])
  // /releases takes no artist_id filter, so narrow here rather than passing one
  // that would be silently ignored and list EVERY release under one artist.
  const releases = useMemo(
    () => (form.artist_id ? allReleases.filter((r) => String(r.artist_id) === String(form.artist_id)) : []),
    [allReleases, form.artist_id]
  )
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const create = async () => {
    setBusy(true); setErr('')
    try {
      await api.post('/campaigns', {
        name: form.name, platform: form.platform,
        artist_id: form.artist_id ? Number(form.artist_id) : null,
        release_id: form.release_id ? Number(form.release_id) : null,
        planned_budget: form.planned_budget ? Number(form.planned_budget) : 0,
        start_date: `${month}-15`,
      })
      onCreated()
    } catch (e) { setErr(e?.response?.data?.error || e.message); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="New campaign" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={create} disabled={busy || !form.name.trim() || !form.artist_id}>{busy ? 'Creating…' : 'Create'}</Button></>}>
      {err && <p className="text-[12px] text-danger mb-2">{err}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="label">Campaign name *</label><input className="input" value={form.name} onChange={set('name')} /></div>
        <div><label className="label">Platform</label>
          <select className="input" value={form.platform} onChange={set('platform')}>
            {['Facebook', 'Instagram', 'TikTok', 'Spotify', 'YouTube', 'Google'].map((p) => <option key={p}>{p}</option>)}
          </select></div>
        <div><label className="label">Artist *</label>
          <select className="input" value={form.artist_id} onChange={set('artist_id')}>
            <option value="">Choose…</option>
            {artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
        <div><label className="label">Song (optional)</label>
          <select className="input" value={form.release_id} onChange={set('release_id')} disabled={!form.artist_id}>
            <option value="">—</option>
            {releases.map((r) => <option key={r.id} value={r.id}>{r.project_name || `#${r.id}`}</option>)}
          </select></div>
        <div><label className="label">Planned budget</label><input className="input tabular-nums" inputMode="decimal" value={form.planned_budget} onChange={set('planned_budget')} /></div>
      </div>
      <p className="text-[11px] text-ink-faint mt-3">Dated {month}-15 — the month you are allocating.</p>
    </Modal>
  )
}

// The pool's vocabulary. EQUALITY on the whole name, never a substring.
function PoolRulesModal({ onClose, onChanged }) {
  const [state, setState] = useState({ rules: [], candidates: [] })
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState('')
  const [scope, setScope] = useState('vendor')
  const load = () => api.get('/reports/label-level-rules').then((r) => setState(r.data.data)).catch(() => {})
  useEffect(() => { load() }, [])
  const add = async (scopeIn, keyIn) => {
    if (!keyIn.trim()) return
    setBusy(true)
    try { await api.post('/reports/label-level-rules', { scope: scopeIn, rule_key: keyIn.trim() }); setKey(''); await load(); onChanged?.() }
    finally { setBusy(false) }
  }
  const remove = async (id) => {
    setBusy(true)
    try { await api.delete(`/reports/label-level-rules/${id}`); await load(); onChanged?.() } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="Which spend bills the label?" size="lg">
      <p className="text-[12px] text-ink-muted mb-3">
        A rule says this vendor&rsquo;s (or category&rsquo;s) charges are the label&rsquo;s overhead, not a release cost.
        Their unattributed spend becomes the ad pool here, and leaves the &ldquo;names an artist&rdquo; coverage figure on
        Artist Campaigns — because no amount of work would ever put an artist on it. Matched on the
        <strong> whole name</strong>, never a substring, so a rule on <em>Salary</em> leaves <em>Salary (Felipe)</em> alone.
      </p>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <select value={scope} onChange={(e) => setScope(e.target.value)} className="input !py-1.5 !w-auto text-sm">
          <option value="vendor">Vendor</option><option value="category">Category</option>
        </select>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={scope === 'vendor' ? 'Meta Platforms' : 'Advertisements'}
          className="input !py-1.5 text-sm flex-1 min-w-[180px]" />
        <Button onClick={() => add(scope, key)} disabled={busy || !key.trim()}>Add rule</Button>
      </div>

      {state.rules.length > 0 && (
        <div className="rounded-lg border border-rule overflow-hidden mb-4">
          {state.rules.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] border-b border-divider last:border-0">
              <span className="text-[10px] font-bold uppercase text-ink-faint w-16">{r.scope}</span>
              <span className="text-ink font-medium truncate flex-1">{r.rule_key}</span>
              {r.reason && <span className="text-[11px] text-ink-faint truncate max-w-[180px]">{r.reason}</span>}
              <button onClick={() => remove(r.id)} disabled={busy} className="text-ink-faint hover:text-danger" aria-label="Remove rule"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}

      {state.candidates.length > 0 && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">Vendors with unattributed spend</p>
          <div className="rounded-lg border border-rule overflow-hidden max-h-64 overflow-y-auto">
            {state.candidates.map((c) => (
              <div key={c.payee} className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] border-b border-divider last:border-0">
                <span className="text-ink truncate flex-1">{c.payee}</span>
                <span className="text-ink-faint tabular-nums text-[11px]">{c.count} row{c.count === 1 ? '' : 's'}</span>
                <span className="text-ink tabular-nums font-medium w-24 text-right">{usd0(c.usd)}</span>
                <button onClick={() => add('vendor', c.payee)} disabled={busy}
                  className="text-[11px] font-semibold text-brand-ink hover:underline">Bills the label</button>
              </div>
            ))}
          </div>
          <p className="text-[10.5px] text-ink-faint mt-1.5">
            Suggestions only — a vendor here may simply be waiting for somebody to name its artist. Rule the ones that
            never could.
          </p>
        </>
      )}
    </Modal>
  )
}
