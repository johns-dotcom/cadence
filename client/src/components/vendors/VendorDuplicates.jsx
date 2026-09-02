import { useEffect, useMemo, useState } from 'react'
import { GitMerge, ArrowLeftRight, Tag, XCircle, Sparkles, Undo2, AlertTriangle } from 'lucide-react'
import api from '../../api'
import Skeleton from '../Skeleton'
import ReviewDeck from '../ReviewDeck'
import ConfirmDialog from '../ui/ConfirmDialog'
import { money } from '../../utils/money'
import { formatDate } from '../../utils/dates'

// Vendor duplicate review — the pair-at-a-time surface.
//
// Five different answers, because "these two names" has five honest outcomes
// and a single Merge button forces three of them into the wrong one:
//   Merge          — same vendor, keep the suggested spelling
//   Swap           — same vendor, the OTHER spelling is the right one
//   Custom name    — same vendor, BOTH spellings are wrong
//   Alias only     — related, but the ledger rows should not be rewritten
//   Not duplicates — genuinely different companies; never ask again
//
// The persisted "not duplicates" is what makes the queue finishable: without
// it every review session starts from the same 40 pairs.

const AUTO_THRESHOLD = 0.9

function PairBody({ p, inDeck, facing, isAdmin, busy, doMerge, doAlias, doAck, setSwapped, onSkip }) {
  const { keep, fold } = facing(p)
  const side = (v, label, tone) => (
    <div className={`flex-1 min-w-0 rounded-lg border p-2.5 ${tone}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="text-sm font-semibold text-ink truncate">{v.payee}</p>
      <p className="text-[11px] text-ink-faint">
        {v.invoice_count} invoice{v.invoice_count === 1 ? '' : 's'} · {money(v.total_usd)}
        {v.has_w9 ? ' · W9' : ''}
      </p>
      {v.last_invoice && <p className="text-[11px] text-ink-faint">last {formatDate(v.last_invoice)}</p>}
    </div>
  )
  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold text-ink tabular-nums">{Math.round(p.score * 100)}%</span>
        <span className="text-xs text-ink-muted">{p.reason}</span>
        {p.tier === 'exact' && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-ink">exact</span>}
      </div>
      <div className="flex items-stretch gap-2">
        {side(keep, 'Keeps this name', 'border-rule bg-brand-500/10')}
        {side(fold, 'Folds in', 'border-divider')}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button disabled={!isAdmin || busy === p.pair_key} onClick={() => doMerge(p)} className="btn-primary !py-1.5 text-xs">
          <GitMerge size={13} /> Merge into “{keep.payee}”
        </button>
        <button disabled={busy === p.pair_key}
          onClick={() => setSwapped((s) => { const n = new Set(s); n.has(p.pair_key) ? n.delete(p.pair_key) : n.add(p.pair_key); return n })}
          className="btn-secondary !py-1.5 text-xs"><ArrowLeftRight size={13} /> Swap</button>
        <button disabled={!isAdmin || busy === p.pair_key} onClick={() => doAlias(p)} className="btn-secondary !py-1.5 text-xs">
          <Tag size={13} /> Alias only
        </button>
        <button disabled={!isAdmin || busy === p.pair_key} onClick={() => doAck(p)} className="btn-secondary !py-1.5 text-xs">
          <XCircle size={13} /> Not duplicates
        </button>
        {inDeck && <button onClick={onSkip} className="btn-secondary !py-1.5 text-xs">Skip</button>}
      </div>
      {isAdmin && (
        <div className="flex items-center gap-2 mt-2">
          {/* Uncontrolled on purpose: the deck re-renders on every keystroke
              elsewhere, and a controlled field here would fight the card. */}
          <input className="input !py-1.5 text-xs" placeholder="…or merge both into a third spelling"
            onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) doMerge(p, e.target.value.trim()) }} />
          <span className="text-[11px] text-ink-faint flex-shrink-0">Enter to apply</span>
        </div>
      )}
      <p className="text-[11px] text-ink-faint mt-2">
        Merging renames every one of “{fold.payee}”’s entries, moves its saved emails, bank lessons and vendor record,
        and leaves “{fold.payee}” as an alias. It is reversible from the merge history on “{keep.payee}”.
      </p>
    </>
  )
}

export default function VendorDuplicates({ isAdmin, onChanged, toast }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [swapped, setSwapped] = useState(() => new Set())
  const [busy, setBusy] = useState(null)
  const [deck, setDeck] = useState(false)
  const [index, setIndex] = useState(0)
  const [stats, setStats] = useState({ merged: 0, aliased: 0, 'marked different': 0, skipped: 0 })
  const [bulk, setBulk] = useState(false)

  const load = () => {
    setLoading(true)
    api.get('/ledger/vendors/duplicates')
      .then((r) => { setData(r.data.data); setError(null) })
      .catch((e) => setError(e.response?.data?.error || 'Could not load duplicates'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const pairs = data?.pairs || []
  // Swap is a per-pair view flip, not a server fact — it survives until the
  // pair is resolved and never leaks into another pair.
  const facing = (p) => (swapped.has(p.pair_key) ? { keep: p.fold, fold: p.keep } : { keep: p.keep, fold: p.fold })
  const autoable = useMemo(() => pairs.filter((p) => p.score >= AUTO_THRESHOLD), [pairs])

  const skip = () => { setStats((s) => ({ ...s, skipped: s.skipped + 1 })); setIndex((i) => i + 1) }
  const resolve = (pairKey) => {
    setData((d) => ({ ...d, pairs: (d.pairs || []).filter((p) => p.pair_key !== pairKey) }))
    onChanged?.()
  }

  const doMerge = async (p, customName) => {
    const { keep, fold } = facing(p)
    setBusy(p.pair_key)
    try {
      const r = await api.post('/ledger/vendors/merge', {
        from: fold.payee, into: keep.payee, rename_into_to: customName || undefined,
      })
      const d = r.data.data || {}
      toast(`Merged into “${d.into || keep.payee}” — ${d.moved || 0} entries renamed${d.cascaded ? `, ${d.cascaded} bank/alias reference${d.cascaded === 1 ? '' : 's'} moved` : ''}`)
      setStats((s) => ({ ...s, merged: s.merged + 1 }))
      resolve(p.pair_key)
    } catch (e) { toast(e.response?.data?.error || 'Merge failed', 'error') }
    finally { setBusy(null) }
  }
  const doAlias = async (p) => {
    const { keep, fold } = facing(p)
    setBusy(p.pair_key)
    try {
      await api.post(`/ledger/vendors/${encodeURIComponent(keep.payee)}/aliases`, { alias: fold.payee })
      toast(`“${fold.payee}” now resolves to “${keep.payee}” — no ledger rows were rewritten`)
      setStats((s) => ({ ...s, aliased: s.aliased + 1 }))
      resolve(p.pair_key)
    } catch (e) { toast(e.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }
  const doAck = async (p) => {
    setBusy(p.pair_key)
    try {
      await api.post('/ledger/vendors/duplicates/ack', { a: p.keep.payee, b: p.fold.payee })
      setStats((s) => ({ ...s, 'marked different': s['marked different'] + 1 }))
      setData((d) => ({
        ...d,
        pairs: (d.pairs || []).filter((x) => x.pair_key !== p.pair_key),
        acked: [{ pair_key: p.pair_key, names: [p.keep.payee, p.fold.payee], note: null, by: 'you', at: new Date().toISOString() }, ...(d.acked || [])],
      }))
    } catch (e) { toast(e.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }
  const unAck = async (a) => {
    try {
      await api.delete('/ledger/vendors/duplicates/ack', { params: { a: a.names[0], b: a.names[1] } })
      load()
    } catch { toast('Failed', 'error') }
  }
  const mergeAll = async () => {
    setBulk(false)
    let ok = 0; const failed = []
    for (const p of autoable) {
      const { keep, fold } = facing(p)
      try { await api.post('/ledger/vendors/merge', { from: fold.payee, into: keep.payee }); ok += 1 }
      catch (e) { failed.push(`${fold.payee}: ${e.response?.data?.error || 'failed'}`) }
    }
    toast(failed.length ? `${ok} merged, ${failed.length} failed — ${failed[0]}` : `${ok} vendor${ok === 1 ? '' : 's'} merged`, failed.length ? 'error' : 'success')
    load(); onChanged?.()
  }

  // Deck keyboard. Fresh closure every render so the handlers act on the card
  // currently showing, not the one that was showing when the deck opened.
  useEffect(() => {
    if (!deck) return
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
      const p = pairs[index]
      if (!p) return
      if (e.key === 'ArrowRight') { e.preventDefault(); doMerge(p) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); skip() }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); setSwapped((s) => { const n = new Set(s); n.has(p.pair_key) ? n.delete(p.pair_key) : n.add(p.pair_key); return n }) }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); doAlias(p) }
      else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); doAck(p) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (loading) return <div className="card p-2"><Skeleton.Table rows={5} cols={4} /></div>
  if (error) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-danger mb-3">{error}</p>
        <button onClick={load} className="btn-secondary mx-auto">Retry</button>
      </div>
    )
  }

  return (
    <>
      <div className="card px-4 py-3 flex flex-wrap items-center gap-3 mb-4">
        <p className="text-sm text-ink">
          <span className="font-bold">{pairs.length}</span> possible duplicate pair{pairs.length === 1 ? '' : 's'}
          <span className="text-ink-faint"> across {data?.vendor_count || 0} payees</span>
        </p>
        {pairs.length > 0 && (
          <button onClick={() => { setIndex(0); setDeck(true) }} className="btn-secondary !py-1.5 text-xs">
            Review {pairs.length} one at a time
          </button>
        )}
        {isAdmin && autoable.length > 0 && (
          <button onClick={() => setBulk(true)} className="btn-secondary !py-1.5 text-xs">
            <Sparkles size={13} /> Merge all {autoable.length} at {Math.round(AUTO_THRESHOLD * 100)}%+
          </button>
        )}
        {!isAdmin && <span className="text-xs text-ink-faint">Merging is admin-only — you can review the list.</span>}
      </div>

      {pairs.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-muted">No duplicate-looking payees. Pairs you have merged or marked different stay out of this list.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pairs.map((p) => (
            <div key={p.pair_key} className="card p-4">
              <PairBody p={p} facing={facing} isAdmin={isAdmin} busy={busy}
                doMerge={doMerge} doAlias={doAlias} doAck={doAck} setSwapped={setSwapped} onSkip={skip} />
            </div>
          ))}
        </div>
      )}

      {(data?.acked || []).length > 0 && (
        <div className="card p-4 mt-4">
          <p className="text-xs font-bold text-ink mb-2">Marked as different vendors ({data.acked.length})</p>
          <div className="space-y-1.5">
            {data.acked.map((a) => (
              <div key={a.pair_key} className="flex items-center gap-2 text-xs">
                <span className="flex-1 min-w-0 truncate text-ink-muted">
                  {a.names[0]} <span className="text-ink-faint">≠</span> {a.names[1]}
                  {a.note && <span className="text-ink-faint"> · {a.note}</span>}
                  <span className="text-ink-faint"> · {a.by || '—'} {a.at ? formatDate(a.at) : ''}</span>
                </span>
                {isAdmin && (
                  <button onClick={() => unAck(a)} className="text-ink-faint hover:text-ink inline-flex items-center gap-1">
                    <Undo2 size={12} /> Put back
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <ReviewDeck
        open={deck}
        title="Duplicate vendors"
        items={pairs}
        index={index}
        stats={stats}
        onClose={() => { setDeck(false); load() }}
      >
        {(p) => (
          <div>
            <PairBody p={p} inDeck facing={facing} isAdmin={isAdmin} busy={busy}
              doMerge={doMerge} doAlias={doAlias} doAck={doAck} setSwapped={setSwapped} onSkip={skip} />
            <p className="text-[11px] text-ink-faint mt-3 border-t border-divider pt-2">
              → merge · ← skip · S swap · A alias only · D not duplicates · Esc close
            </p>
          </div>
        )}
      </ReviewDeck>

      <ConfirmDialog
        open={bulk}
        onClose={() => setBulk(false)}
        onConfirm={mergeAll}
        title={`Merge ${autoable.length} pairs?`}
        confirmLabel={`Merge ${autoable.length}`}
        variant="primary"
        message={
          <div className="text-sm text-ink-muted">
            <p className="mb-2 inline-flex items-start gap-1.5">
              <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
              Each of these renames every entry under the folded name. Every one is individually reversible from the surviving vendor’s merge history.
            </p>
            <ul className="mt-2 space-y-0.5 max-h-52 overflow-y-auto">
              {autoable.map((p) => {
                const f = facing(p)
                return <li key={p.pair_key} className="tabular-nums">{Math.round(p.score * 100)}% · “{f.fold.payee}” → “{f.keep.payee}”</li>
              })}
            </ul>
          </div>
        }
      />
    </>
  )
}
