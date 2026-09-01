// Recoupment audit — /recoupments/audit
//
// The Recoupments page answers "what can we recoup". This one answers the
// question that page cannot ask about itself: "is anything missing, and is
// anything claimed that shouldn't be?"
//
// Five checks. Two find money NOT claimed (advances with no artist, half-claimed
// split payments), one finds money never judged either way (the bank pile), two
// find money claimed wrongly (possible double claims, claims with no document).
// Each ships with the remediation inline, because a finding you have to go
// somewhere else to fix is a finding that stays.
//
// This page derives NO money of its own. Every figure comes from
// GET /financials/recoupment-audit — a predicate about money that lives in two
// places disagrees with itself eventually.
//
// Deliberately NOT here: "claimed with no bank line". That already has a tile
// on the Recoupments index, and one condition with two homes is how two homes
// start disagreeing.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, AlertTriangle, Copy, FileWarning, Scissors,
  PiggyBank, Layers, Check, Trash2, ExternalLink, ChevronRight, EyeOff,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import BankEvidenceDot from '../components/BankEvidenceDot'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { money, moneyCompact, moneyOrig } from '../utils/money'
import useFocusRefetch from '../hooks/useFocusRefetch'

// The row's own USD, computed server-side by usdOf — never face value for a
// foreign row, and never zero.
const rowUsd = (r) => Number(r?.amount_usd_calc ?? r?.amount ?? 0)

const CHECKS = [
  { id: 'advances', label: 'Advances waiting for an artist', icon: PiggyBank, kicker: 'Not claimed', noun: 'item',
    tone: 'text-brand-ink',
    blurb: 'Bank-imported payments in artist-and-record categories that name nobody. An advance is an artist’s own money, so a row here is a recoupable cost with nobody to bill.' },
  { id: 'pile', label: 'Bank costs never answered', icon: Layers, kicker: 'Unanswered', noun: 'row',
    tone: 'text-warning',
    blurb: '`recoupable` is TRUE by default on every statement-born row, which is not a decision — so it is off the Recoupments page until somebody answers, one row or one whole class at a time.' },
  { id: 'double', label: 'Possibly claimed twice', icon: Copy, kicker: 'Claimed', noun: 'group',
    tone: 'text-danger',
    blurb: 'Same vendor, same invoice number, claimed more than once. A sensor, not a verdict — separate deliverables do get billed on one number. Groups spanning two artists come first.' },
  { id: 'nodoc', label: 'Claimed with no document', icon: FileWarning, kicker: 'Claimed', noun: 'item',
    tone: 'text-danger',
    blurb: 'Uploaded for recoupment with no file anywhere in the family — the parent’s counts, since that is where a split child’s document lives. If the artist asks to see it, there is nothing to send.' },
  { id: 'partial', label: 'Half a payment claimed', icon: Scissors, kicker: 'Not claimed', noun: 'payment',
    tone: 'text-warning',
    blurb: 'A split payment with one slice claimed and its siblings not. Nobody decides this on purpose: it is what a split looks like when the claim was made before it.' },
]

export default function RecoupmentAudit() {
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [active, setActive] = useState('advances')
  const [busy, setBusy] = useState(false)

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    setErr('')
    try {
      const res = await api.get('/financials/recoupment-audit')
      setData(res.data?.data || null)
    } catch (e) {
      setErr(e.response?.data?.error || e.message)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useFocusRefetch(() => load(true))

  const t = data?.totals || {}
  const counts = {
    advances: { n: t.advances_items || 0, usd: t.advances_usd || 0 },
    pile: { n: t.pile_items || 0, usd: t.pile_usd || 0 },
    double: { n: t.double_claims_groups || 0, usd: t.double_claims_usd || 0 },
    nodoc: { n: t.no_document_items || 0, usd: t.no_document_usd || 0 },
    partial: { n: t.partial_families_count || 0, usd: t.partial_families_usd || 0 },
  }
  // Money not claimed and money claimed wrongly are NOT added together
  // anywhere on this page. One "$1.5M of exposure" headline would be summing
  // things that need opposite actions.
  const missing = counts.advances.usd + counts.partial.usd
  const suspect = counts.double.usd + counts.nodoc.usd
  const done = (msg) => { toast(msg); load(true) }

  return (
    <div className="space-y-4">
      <Link to="/recoupments" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-ink-muted border border-rule hover:text-ink hover:bg-brand-500/5">
        <ArrowLeft size={13} /> Recoupments
      </Link>

      <PageHeader
        title="Recoupment audit"
        subtitle="Five checks on the recoupment ledger — money that should be claimed and has not been, and money claimed that cannot be shown"
        action={
          <button onClick={() => load()} disabled={loading} className="btn-secondary disabled:opacity-40">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Recheck
          </button>
        } />

      {err && (
        <div className="card p-3 border-l-4 border-l-danger flex items-center justify-between gap-3">
          <p className="text-xs text-danger font-semibold">{err}</p>
          <button onClick={() => load()} className="btn-secondary !py-1 text-xs">Retry</button>
        </div>
      )}

      {loading && !data && <div className="card p-2"><Skeleton.Table rows={6} cols={5} /></div>}

      {data && (
        <>
          {/* Two sentences of arithmetic, stated rather than merged. */}
          <div className="card p-3">
            <p className="text-xs text-ink-muted leading-relaxed">
              <span className="font-bold text-ink">{money(missing)}</span> looks claimable and is not claimed{' '}
              <span className="text-ink-faint">({counts.advances.n} advance{counts.advances.n === 1 ? '' : 's'}, {counts.partial.n} part-claimed payment{counts.partial.n === 1 ? '' : 's'})</span>
              {' · '}
              <span className="font-bold text-danger">{money(suspect)}</span> is claimed and needs a second look{' '}
              <span className="text-ink-faint">({counts.double.n} possible duplicate{counts.double.n === 1 ? '' : 's'}, {counts.nodoc.n} with no document)</span>
              {counts.pile.n > 0 && (
                <>{' · '}<span className="font-bold text-warning">{money(counts.pile.usd)}</span> of bank spend has never been judged either way{' '}
                  <span className="text-ink-faint">({counts.pile.n.toLocaleString()} rows)</span></>
              )}
            </p>
          </div>

          {/* Tiles double as the section selector — five checks, one open. */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {CHECKS.map(c => {
              const on = active === c.id
              const k = counts[c.id]
              const clean = k.n === 0
              return (
                <button key={c.id} type="button" onClick={() => setActive(c.id)} title={c.blurb}
                  className={`card p-3 text-left transition ${on ? 'ring-2 ring-brand-500' : 'hover:bg-brand-500/5'} ${clean ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-1.5">
                    <c.icon size={13} className={clean ? 'text-ink-faint' : c.tone} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{c.kicker}</span>
                  </div>
                  <div className={`mt-1.5 text-xl font-bold tabular-nums ${clean ? 'text-ink-faint' : c.tone}`} title={money(k.usd)}>
                    {clean ? '—' : moneyCompact(k.usd)}
                  </div>
                  <div className="text-[11px] font-semibold text-ink leading-tight">{c.label}</div>
                  <div className="mt-0.5 text-[10px] text-ink-faint tabular-nums">
                    {clean ? 'nothing found' : `${k.n.toLocaleString()} ${c.noun}${k.n === 1 ? '' : 's'}`}
                    {c.id === 'double' && t.double_claims_cross_artist > 0 && (
                      <span className="text-danger font-semibold"> · {t.double_claims_cross_artist} across two artists</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          <p className="text-[11px] text-ink-faint px-1">{CHECKS.find(c => c.id === active)?.blurb}</p>

          {active === 'advances' && <Advances rows={data.advances} artistOptions={data.artist_options || []} busy={busy} setBusy={setBusy} done={done} toast={toast} />}
          {active === 'pile' && <Pile pile={data.pile} busy={busy} setBusy={setBusy} done={done} toast={toast} />}
          {active === 'double' && <DoubleClaims groups={data.double_claims} busy={busy} setBusy={setBusy} done={done} toast={toast} />}
          {active === 'nodoc' && <NoDocument groups={data.no_document} busy={busy} setBusy={setBusy} done={done} toast={toast} />}
          {active === 'partial' && <PartialFamilies families={data.partial_families} busy={busy} setBusy={setBusy} done={done} toast={toast} />}
        </>
      )}
    </div>
  )
}

// "Nothing found" is a RESULT here, not an absence, so it says which check ran.
function Clean({ what }) {
  return (
    <div className="card p-6 text-center">
      <Check size={20} className="mx-auto text-success" />
      <p className="mt-2 text-sm font-semibold text-ink">Nothing to answer</p>
      <p className="mt-1 text-xs text-ink-muted">{what}</p>
    </div>
  )
}

const fail = (toast) => (e) => toast(e.response?.data?.error || e.message || 'Failed', 'error')

// ── 1. Advances waiting for an artist ────────────────────────────────────────
function Advances({ rows, artistOptions, busy, setBusy, done, toast }) {
  // Keyed by row id so two rows being answered at once cannot share a value.
  const [picked, setPicked] = useState({})
  if (!rows?.length) return <Clean what="No advance, recording or tour cost is missing its artist." />

  const answer = async (row, recoupable) => {
    const artist = String(picked[row.id] ?? row.artist_proposal ?? '').trim()
    if (recoupable && !artist) {
      toast('Name the artist first — a recoupable advance with nobody to bill is what this list is for', 'error')
      return
    }
    setBusy(true)
    try {
      await api.post('/financials/recoupments/review', { ids: [row.id], recoupable, ...(recoupable ? { artist } : {}) })
      done(recoupable ? `${money(rowUsd(row))} now recoupable against ${artist}` : `${row.payee} marked not recoupable`)
    } catch (e) { fail(toast)(e) } finally { setBusy(false) }
  }

  return (
    <div className="card divide-y divide-divider">
      <datalist id="audit-artists">{artistOptions.map(a => <option key={a} value={a} />)}</datalist>
      {rows.map(r => (
        <div key={r.id} className="p-3">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <BankEvidenceDot row={r} />
                <span className="text-sm font-semibold text-ink truncate">{r.payee || '—'}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{r.category}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-ink-muted tabular-nums">
                paid {formatDate(r.payment_date) || '—'}
                {r.currency && r.currency !== 'USD' && ` · ${moneyOrig(r.amount, r.currency)}`}
                {r.description && ` · ${String(r.description).slice(0, 60)}`}
              </div>
              {/* The one thing that stops this becoming a double count. */}
              {r.ledger_twin && (
                <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-danger">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {r.ledger_twin.count === 1
                      ? 'An invoice row already exists at this vendor and amount'
                      : `${r.ledger_twin.count} invoice rows already exist at this vendor and amount`}
                    {' — '}
                    {r.ledger_twin.rows.map((tw, i) => (
                      <span key={tw.id}>
                        {i > 0 && ', '}
                        <Link to={`/ledger?focus=${tw.id}`} className="font-semibold hover:underline">
                          #{tw.id}{tw.artist ? ` (${tw.artist})` : ''}{tw.ufr ? ' claimed' : ''}
                        </Link>
                      </span>
                    ))}
                    . Tie the bank line to it on <Link to="/bank-matching" className="font-semibold hover:underline">Bank Matching</Link>{' '}
                    rather than answering here, or the same cost is claimed twice.
                  </span>
                </div>
              )}
            </div>
            <div className="text-base font-bold tabular-nums text-ink whitespace-nowrap">{money(rowUsd(r))}</div>
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <input list="audit-artists" value={picked[r.id] ?? r.artist_proposal ?? ''}
              onChange={e => setPicked(p => ({ ...p, [r.id]: e.target.value }))}
              placeholder="Which artist is this advance against?"
              className="input !py-1.5 text-xs flex-1 min-w-[14rem]" />
            {/* A proposal, and it says so. */}
            {r.artist_proposal && (picked[r.id] ?? r.artist_proposal) === r.artist_proposal && (
              <span className="text-[10px] text-ink-faint" title="Taken from the payee, which contains an artist name already used in the ledger. Nothing is written until you press the button.">
                from the payee — check it
              </span>
            )}
            <button type="button" disabled={busy} onClick={() => answer(r, true)} className="btn-primary !py-1.5 text-xs disabled:opacity-40">Recoupable</button>
            <button type="button" disabled={busy} onClick={() => answer(r, false)}
              title="Records the decision AND clears recoupable, so the row stops claiming to be recoupable everywhere else"
              className="btn-secondary !py-1.5 text-xs disabled:opacity-40">Not recoupable</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 2. The bank pile ─────────────────────────────────────────────────────────
function Pile({ pile, busy, setBusy, done, toast }) {
  const [sel, setSel] = useState(() => new Set())
  const open = (pile?.by_category || []).filter(c => !c.ruled)
  const selUsd = useMemo(() => open.filter(c => sel.has(c.category)).reduce((t, c) => t + c.usd, 0), [open, sel])
  const selItems = useMemo(() => open.filter(c => sel.has(c.category)).reduce((t, c) => t + c.n, 0), [open, sel])
  const toggle = (cat) => setSel(p => { const n = new Set(p); n.has(cat) ? n.delete(cat) : n.add(cat); return n })

  const declare = async () => {
    if (!sel.size) return
    setBusy(true)
    try {
      const { data } = await api.post('/financials/recoupment-class-rules', { scope: 'category', keys: [...sel] })
      setSel(new Set())
      done(`${data?.data?.made?.length || 0} categor${(data?.data?.made?.length || 0) === 1 ? 'y' : 'ies'} marked never recoupable`)
    } catch (e) { fail(toast)(e) } finally { setBusy(false) }
  }
  const undo = async (rule) => {
    setBusy(true)
    try { await api.delete(`/financials/recoupment-class-rules/${rule.id}`); done(`${rule.rule_key} is back in the queue`) }
    catch (e) { fail(toast)(e) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <p className="text-[11px] text-ink-muted">
          Marking a class never recoupable <b className="text-ink">writes nothing to the ledger</b> — it takes those rows out of this
          queue and nothing else, and deleting the rule puts them straight back. Rows that need a person, one at a time, are on the{' '}
          <Link to="/recoupments" className="font-semibold text-brand-ink hover:underline">Recoupments</Link> Bank-review tab.
        </p>
      </div>

      {open.length === 0 ? (
        <Clean what="Every class of bank spend has been answered or ruled out." />
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-divider">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {open.length} categories · {pile.remaining_items.toLocaleString()} rows · {money(pile.remaining_usd)}
            </span>
            {sel.size > 0 && (
              <>
                <span className="text-[11px] text-ink-muted tabular-nums">{sel.size} selected · {selItems.toLocaleString()} rows · {money(selUsd)}</span>
                <button type="button" onClick={declare} disabled={busy} className="ml-auto btn-primary !py-1.5 text-xs disabled:opacity-40">
                  <EyeOff size={12} /> Never recoupable
                </button>
              </>
            )}
          </div>
          <div className="max-h-[28rem] overflow-y-auto divide-y divide-divider">
            {open.map(c => (
              <label key={c.category} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-brand-500/5">
                <input type="checkbox" checked={sel.has(c.category)} onChange={() => toggle(c.category)} />
                <span className="text-xs font-semibold text-ink flex-1 truncate">{c.category}</span>
                <span className="text-[11px] text-ink-faint tabular-nums w-20 text-right">{c.n.toLocaleString()} rows</span>
                <span className="text-xs font-semibold tabular-nums text-ink w-28 text-right">{money(c.usd)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {(pile?.rules || []).length > 0 && (
        <div className="card p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Never recoupable · {pile.rules.length} rule{pile.rules.length === 1 ? '' : 's'}
            {pile.covered_items > 0 && (
              <span className="font-normal normal-case tracking-normal text-ink-faint"> — covering {pile.covered_items.toLocaleString()} rows, {money(pile.covered_usd)}</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pile.rules.map(r => (
              <span key={r.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-rule text-[11px]">
                <span className="text-ink-faint">{r.scope}</span>
                <span className="font-semibold text-ink">{r.rule_key}</span>
                <button type="button" onClick={() => undo(r)} disabled={busy} title="Put this class back in the queue"
                  className="text-ink-faint hover:text-danger disabled:opacity-40"><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
          {/* Worth stating exactly where somebody is making rules. */}
          <p className="mt-2 text-[10px] text-ink-faint">
            Rules match a category or vendor <b className="text-ink-muted">exactly</b> — a rule on “Salary” does not cover “Salary (Felipe)”.
          </p>
        </div>
      )}
    </div>
  )
}

// ── 3. Possibly claimed twice ────────────────────────────────────────────────
function DoubleClaims({ groups, busy, setBusy, done, toast }) {
  if (!groups?.length) return <Clean what="No vendor has the same invoice number claimed twice." />
  const unclaim = async (row) => {
    setBusy(true)
    try { await api.post('/financials/recoupments/ufr-bulk', { ids: [row.id], ufr: false }); done(`#${row.id} is no longer claimed`) }
    catch (e) { fail(toast)(e) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      {groups.map(g => (
        <div key={`${g.payee}|${g.invoice_number}`} className={`card p-3 ${g.cross_artist ? 'border-l-4 border-l-danger' : ''}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-ink">{g.payee || '—'}</span>
            <span className="text-[11px] text-ink-faint">invoice {g.invoice_number}</span>
            <span className="text-[11px] text-ink-faint">· {g.rows.length} claims</span>
            {g.cross_artist && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-danger">
                <AlertTriangle size={11} /> charged to {g.artists.join(' and ')}
              </span>
            )}
            <span className="ml-auto text-base font-bold tabular-nums text-ink">{money(g.usd)}</span>
          </div>
          <div className="mt-2 divide-y divide-divider">
            {g.rows.map(r => (
              <div key={r.id} className="flex items-center gap-2 py-1.5 text-xs">
                <BankEvidenceDot row={r} />
                <span className="text-ink-faint tabular-nums w-14">#{r.id}</span>
                <span className="font-semibold text-ink truncate flex-1">
                  {r.artist || <span className="text-ink-faint font-normal">no artist</span>}
                  {r.song && <span className="text-ink-faint font-normal"> · {r.song}</span>}
                </span>
                <span className="text-ink-faint tabular-nums whitespace-nowrap">{formatDate(r.invoice_date) || '—'}</span>
                <span className="font-semibold tabular-nums w-24 text-right">{money(rowUsd(r))}</span>
                <Link to={`/ledger?focus=${r.id}`} title="Open in the ledger" className="text-ink-faint hover:text-brand-ink"><ExternalLink size={12} /></Link>
                <button type="button" onClick={() => unclaim(r)} disabled={busy}
                  title="Take this one off the recoupment claim. The other stays."
                  className="btn-secondary !py-1 !px-2 text-[11px] disabled:opacity-40">Unclaim</button>
              </div>
            ))}
          </div>
          {/* Said once per group: the honest answer is often "both are real". */}
          <p className="mt-1.5 text-[10px] text-ink-faint">
            Two deliverables billed on one invoice number are legitimate. Unclaim only the one that is genuinely the same cost twice.
          </p>
        </div>
      ))}
    </div>
  )
}

// ── 4. Claimed with no document ──────────────────────────────────────────────
function NoDocument({ groups, busy, setBusy, done, toast }) {
  if (!groups?.length) return <Clean what="Every claimed cost has an invoice or receipt on file." />
  const unclaim = async (r) => {
    setBusy(true)
    try { await api.post('/financials/recoupments/ufr-bulk', { ids: [r.id], ufr: false }); done(`#${r.id} is no longer claimed`) }
    catch (e) { fail(toast)(e) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      {groups.map(a => (
        <div key={a.artist} className="card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-divider">
            <span className="text-xs font-semibold text-ink">{a.artist}</span>
            <span className="text-[11px] text-ink-faint tabular-nums">{a.list.length} item{a.list.length === 1 ? '' : 's'}</span>
            <span className="ml-auto text-sm font-bold tabular-nums text-danger">{money(a.usd)}</span>
          </div>
          <div className="divide-y divide-divider">
            {a.list.map(r => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <BankEvidenceDot row={r} />
                <span className="font-semibold text-ink truncate flex-1">{r.payee || '—'}</span>
                <span className="text-ink-faint truncate max-w-[10rem]">{r.song || r.category}</span>
                <span className="text-ink-faint tabular-nums whitespace-nowrap">claimed {formatDate(r.ufr_marked_at) || '—'}</span>
                <span className="font-semibold tabular-nums w-24 text-right">{money(rowUsd(r))}</span>
                {/* The fix is one click from the finding: the ledger drawer is
                    where a file gets attached. */}
                <Link to={`/ledger?focus=${r.id}`} target="_blank" rel="noopener noreferrer"
                  title="Open the entry to attach the invoice"
                  className="btn-secondary !py-1 !px-2 text-[11px]">Attach <ExternalLink size={10} /></Link>
                <button type="button" onClick={() => unclaim(r)} disabled={busy}
                  title="There is no invoice and there is not going to be one — take it off the claim"
                  className="btn-secondary !py-1 !px-2 text-[11px] disabled:opacity-40">Unclaim</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 5. Half a payment claimed ────────────────────────────────────────────────
function PartialFamilies({ families, busy, setBusy, done, toast }) {
  if (!families?.length) return <Clean what="No split payment is part-claimed." />
  const claimRest = async (f) => {
    setBusy(true)
    try {
      const { data } = await api.post('/financials/recoupments/claim-family', { root_id: f.root_id })
      done(`${data?.data?.claimed ?? f.open_ids.length} more slice${(data?.data?.claimed ?? f.open_ids.length) === 1 ? '' : 's'} claimed for ${f.payee}`)
    } catch (e) { fail(toast)(e) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      {families.map(f => (
        <div key={f.root_id} className="card p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-ink">{f.payee || '—'}</span>
            {f.artist && <span className="text-[11px] text-ink-faint">{f.artist}</span>}
            <span className="text-[11px] text-ink-faint">· payment #{f.root_id} split {f.members.length} ways</span>
            <div className="ml-auto text-right">
              <div className="text-base font-bold tabular-nums text-warning">{money(f.open_usd)}</div>
              <div className="text-[10px] text-ink-faint tabular-nums">not claimed · {money(f.claimed_usd)} was</div>
            </div>
          </div>
          <div className="mt-2 divide-y divide-divider">
            {f.members.map(m => (
              <div key={m.id} className="flex items-center gap-2 py-1.5 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${m.ufr ? 'bg-success' : 'bg-warning'}`} />
                <span className="text-ink-faint tabular-nums w-16">#{m.id}{m.parent_id ? '' : ' root'}</span>
                <span className="truncate flex-1 text-ink">{m.song || m.category || '—'}</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${m.ufr ? 'text-success' : 'text-warning'}`}>
                  {m.ufr ? 'claimed' : 'not claimed'}
                </span>
                <span className="font-semibold tabular-nums w-24 text-right">{money(rowUsd(m))}</span>
              </div>
            ))}
          </div>
          {f.hidden_ids.length > 0 && (
            <p className="mt-2 text-[10.5px] text-ink-muted">
              {f.hidden_ids.length} of the unclaimed slice{f.hidden_ids.length === 1 ? ' is a split child, so it' : 's are split children, so they'}{' '}
              cannot be reached from Recoupments or Planning — those surfaces show a split family once, at its root. This button is the way to claim them.
            </p>
          )}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => claimRest(f)} disabled={busy} className="btn-primary !py-1.5 text-xs disabled:opacity-40">
              Claim the other {f.open_ids.length} {f.open_ids.length === 1 ? 'slice' : 'slices'}
            </button>
            <Link to={`/ledger?focus=${f.root_id}`} className="text-[11px] font-semibold text-ink-muted hover:text-brand-ink inline-flex items-center gap-1">
              Open the payment <ChevronRight size={12} />
            </Link>
            <span className="ml-auto text-[10px] text-ink-faint">
              A slice that has never been claimed is stamped with today’s date, so it lands on this month’s statement. Slices already claimed keep their stamp.
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
