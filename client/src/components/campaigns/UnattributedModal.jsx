import { useEffect, useMemo, useState } from 'react'
import { Loader, Tag, Building2 } from 'lucide-react'
import api from '../../api'
import { Modal, Button } from '../ui'
import { formatDate } from '../../utils/dates'

// Campaign spend the statements show that names NO artist — and the two ways out
// of it.
//
// ── Where the rows come from ──
// The Reports artist drill (`/reports/pnl/detail?kind=artist&key=&drillCategory=`),
// not a query of this page's own. The index's `meta.unattributed.by_category`
// figure comes from the same buildPnl the drill re-walks, so the list and the
// number it was opened from tie by construction. A second endpoint with its own
// idea of "unattributed" is how a drill-through ends up disagreeing with the
// report above it.
//
// Two disclosures matter and are stated rather than left to be discovered:
//   * RECOVERIES. `by_artist` is GROSS of contra income while the P&L's own line
//     is net, so the reimbursements netting into these categories are named.
//   * TRUNCATION. The drill caps at 500 rows and says so.
//
// ── Two ways out ──
//   Name an artist   → POST /reports/set-artist on the PART ids the drill
//                      returned, never the family root: a split slice must not
//                      drag its siblings onto an artist nobody chose.
//   Bills the label  → POST /reports/label-level-rules {scope:'vendor'} — for
//                      spend no amount of work would ever attribute (ad
//                      platforms). It leaves the pool for Allocate Advertising
//                      and leaves the coverage denominator.

const usd = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function UnattributedModal({ open, onClose, categories = [], range, meta, onChanged }) {
  const [state, setState] = useState({ loading: true, byCat: [], error: null })
  const [sel, setSel] = useState(new Set())
  const [artist, setArtist] = useState('')
  const [artists, setArtists] = useState([])
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')

  const load = async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const results = await Promise.all(categories.map(async (c) => {
        const { data } = await api.get('/reports/pnl/detail', {
          params: { kind: 'artist', key: '', drillCategory: c, from: range.from, to: range.to },
        })
        return { category: c, ...(data.data || {}) }
      }))
      setState({ loading: false, byCat: results.filter((r) => (r.rows || []).length), error: null })
    } catch (err) {
      setState({ loading: false, byCat: [], error: err.response?.data?.error || err.message })
    }
  }

  useEffect(() => {
    if (!open) return
    setSel(new Set()); setFlash('')
    load()
    api.get('/artists').then((r) => setArtists(r.data?.data || [])).catch(() => {})
  }, [open, range.from, range.to, categories.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const allRows = useMemo(() => state.byCat.flatMap((c) => (c.rows || []).map((r) => ({ ...r, __cat: c.category }))), [state.byCat])
  const selectedRows = allRows.filter((r) => sel.has(r.expense_id))
  const selectedUsd = selectedRows.reduce((t, r) => t + (Number(r.usd) || 0), 0)
  const selectedVendors = [...new Set(selectedRows.map((r) => String(r.payee || '').trim()).filter(Boolean))]

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = (rows) => setSel((s) => {
    const n = new Set(s)
    const every = rows.every((r) => n.has(r.expense_id))
    rows.forEach((r) => (every ? n.delete(r.expense_id) : n.add(r.expense_id)))
    return n
  })

  const nameArtist = async () => {
    if (!artist.trim() || !sel.size) return
    setBusy(true)
    try {
      // PART ids, exactly as the drill returned them.
      const { data } = await api.post('/reports/set-artist', { expense_ids: [...sel], artist: artist.trim() })
      setFlash(`${data.data.updated} row${data.data.updated === 1 ? '' : 's'} now name ${artist.trim()}.`)
      setSel(new Set()); setArtist('')
      await load(); onChanged?.()
    } catch (err) { setFlash(err.response?.data?.error || 'Could not set the artist') } finally { setBusy(false) }
  }

  const makeRule = async () => {
    if (!selectedVendors.length) return
    setBusy(true)
    try {
      const { data } = await api.post('/reports/label-level-rules', {
        scope: 'vendor', rule_keys: selectedVendors, reason: 'bills the label — set from Artist Campaigns',
      })
      setFlash(`${data.data.added} vendor rule${data.data.added === 1 ? '' : 's'} added. Their spend is now the ad pool — allocate it on Allocate Advertising.`)
      setSel(new Set())
      await load(); onChanged?.()
    } catch (err) { setFlash(err.response?.data?.error || 'Could not add the rule') } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Campaign spend that names no artist">
      <p className="text-[12px] text-ink-muted mb-3">
        Cash basis, {range.from} → {range.to} — the same rows the P&amp;L counted. Naming an artist here writes the
        ledger row itself, so Reports, Recoupments and this page all move together.
        {meta?.recoveries > 0 && (
          <span> These figures are <strong>gross</strong>: {usd(meta.recoveries)} of reimbursements net against these
            categories on the P&amp;L.</span>
        )}
      </p>

      {flash && <div className="mb-3 text-[12px] text-ink bg-brand-500/10 border-l-2 border-l-brand-400 px-2.5 py-1.5">{flash}</div>}
      {state.error && <div className="mb-3 text-[12px] text-danger bg-rose-500/10 border-l-2 border-l-danger px-2.5 py-1.5">{state.error}</div>}

      {state.loading ? (
        <p className="text-sm text-ink-muted flex items-center gap-2"><Loader size={14} className="animate-spin" /> Reading the report…</p>
      ) : !state.byCat.length ? (
        <p className="text-sm text-ink-muted">Every campaign row in this range names an artist.</p>
      ) : (
        <div className="space-y-4">
          {state.byCat.map((c) => (
            <div key={c.category}>
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-ink-muted">{c.category}</h3>
                <span className="text-[13px] font-bold text-ink tabular-nums">{usd(c.total)}</span>
                <button onClick={() => toggleAll(c.rows)} className="ml-auto text-[11px] font-semibold text-brand-ink hover:underline">
                  {c.rows.every((r) => sel.has(r.expense_id)) ? 'Clear' : 'Select all'} ({c.rows.length})
                </button>
              </div>
              <div className="rounded-lg border border-rule overflow-hidden">
                {c.rows.map((r) => (
                  <label key={r.expense_id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 text-[12px] border-b border-divider last:border-0 cursor-pointer ${sel.has(r.expense_id) ? 'bg-selected' : 'hover:bg-elev'}`}>
                    <input type="checkbox" checked={sel.has(r.expense_id)} onChange={() => toggle(r.expense_id)} />
                    <span className="text-ink-muted tabular-nums w-20 shrink-0">{formatDate(r.date)}</span>
                    <a href={`/vendors?q=${encodeURIComponent(r.payee || '')}`} onClick={(e) => e.stopPropagation()}
                      className="text-ink font-medium truncate hover:underline">{r.payee || '(no payee)'}</a>
                    {r.song && <span className="text-ink-faint truncate">· {r.song}</span>}
                    {r.split_of && <span className="text-[10px] text-ink-faint">slice of #{r.split_of}</span>}
                    {r.evidence === 'invented' && (
                      <span className="text-[10px] font-bold uppercase text-ink-faint" title="Booked from a bank statement — there is no invoice behind it">bank</span>
                    )}
                    <span className="ml-auto tabular-nums font-medium text-ink">{usd(r.usd)}</span>
                    <a href={`/ledger?focus=${r.expense_id}`} onClick={(e) => e.stopPropagation()}
                      className="text-[11px] text-ink-faint hover:text-brand-ink">open</a>
                  </label>
                ))}
              </div>
              {c.truncated && (
                <p className="text-[10.5px] text-ink-faint mt-1">
                  Showing the newest {c.rows.length} of {c.truncated} rows — narrow the date range to see the rest.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-divider">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2">
          {sel.size ? `${sel.size} selected · ${usd(selectedUsd)}` : 'Select rows to attribute them'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input list="ac-unattributed-artists" value={artist} onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist name…" className="input !py-1.5 text-sm w-52" disabled={!sel.size || busy} />
          <datalist id="ac-unattributed-artists">{artists.map((a) => <option key={a.id} value={a.name} />)}</datalist>
          <Button onClick={nameArtist} disabled={!sel.size || !artist.trim() || busy}>
            <Tag size={14} /> Name this artist
          </Button>
          <span className="text-ink-faint text-[11px]">or</span>
          <Button variant="secondary" onClick={makeRule} disabled={!selectedVendors.length || busy}
            title={selectedVendors.length ? `Rule: ${selectedVendors.join(', ')}` : 'Select rows first'}>
            <Building2 size={14} /> These vendors bill the label
          </Button>
        </div>
        {!!selectedVendors.length && (
          <p className="text-[11px] text-ink-faint mt-1.5">
            A vendor rule covers <strong className="text-ink-muted">every</strong> charge from {selectedVendors.join(', ')}, past
            and future — matched on the whole payee name, never a substring. Their spend leaves the coverage figure and
            becomes the ad pool.
          </p>
        )}
      </div>
    </Modal>
  )
}
