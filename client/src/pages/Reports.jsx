// Reports — P&L / Spend by Artist / Balance Sheet / Dismissed.
// Cash basis, statement-verified. Every valued cell drills through to the
// rows behind it; exclusions and period moves are DISCLOSED in banners
// because they move reported totals.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, RefreshCw } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import Skeleton from '../components/Skeleton'
import PnlTable from '../components/reports/PnlTable'
import DrillModal from '../components/reports/DrillModal'
import SpendByArtist from '../components/reports/SpendByArtist'
import BalanceSheetCard from '../components/reports/BalanceSheetCard'
import DismissedTab from '../components/reports/DismissedTab'
import ReconciledBadge from '../components/statements/ReconciledBadge'
import { localDateStr } from '../utils/dates'

const TABS = [
  ['pnl', 'Profit & Loss'],
  ['artists', 'Spend by Artist'],
  ['bs', 'Balance Sheet'],
  ['dismissed', 'Dismissed'],
]

function defaultRange() {
  const today = localDateStr()
  const [y] = today.split('-')
  return { from: `${y}-01-01`, to: today }
}

export default function Reports() {
  const { toast } = useToast()
  const { label, user } = useAuth()
  const storeKey = `reports:${label?.id || 0}:${user?.id || 0}`

  const [tab, setTab] = useState('pnl')
  const [range, setRange] = useState(defaultRange())
  const [artist, setArtist] = useState('')
  const [asOf, setAsOf] = useState(localDateStr())
  const [pnl, setPnl] = useState(null)
  const [sba, setSba] = useState(null)
  const [bs, setBs] = useState(null)
  const [bsError, setBsError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [drill, setDrill] = useState(null) // { kind, key, keys, month, label, cellTotal, drillCategory }

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(storeKey) || 'null')
      if (s?.range?.from && s?.range?.to) setRange(s.range)
      if (s?.tab) setTab(s.tab)
    } catch { /* default */ }
  }, [storeKey])
  useEffect(() => {
    try { localStorage.setItem(storeKey, JSON.stringify({ range, tab })) } catch { /* quota */ }
  }, [range, tab, storeKey])

  // Pass values explicitly — an onChange refetch fires before state commits.
  const fetchPnl = useCallback(async (r = range, a = artist) => {
    setLoading(true); setError(null)
    try {
      const [p, s] = await Promise.all([
        api.get('/reports/pnl', { params: { from: r.from, to: r.to, artist: a || undefined } }),
        api.get('/reports/spend-by-artist', { params: { from: r.from, to: r.to } }),
      ])
      setPnl(p.data.data); setSba(s.data.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Report failed to load')
    } finally { setLoading(false) }
  }, [range, artist])

  const fetchBs = useCallback(async (d = asOf) => {
    setBsError(null)
    try { const r = await api.get('/reports/balance-sheet', { params: { as_of: d } }); setBs(r.data.data) }
    catch (err) { setBs(null); setBsError(err.response?.data?.error || 'Balance sheet failed') }
  }, [asOf])

  useEffect(() => { fetchPnl(); fetchBs() }, []) // eslint-disable-line

  const exportBlob = async (url, params, filename) => {
    try {
      const res = await api.get(url, { params, responseType: 'blob' })
      const href = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = href; a.download = filename; a.click()
      URL.revokeObjectURL(href)
    } catch { toast('Export failed', 'error') }
  }

  const exportCurrent = () => {
    if (tab === 'artists') return exportBlob('/reports/spend-by-artist/export', { from: range.from, to: range.to }, `cadence-spend-by-artist-${range.from}-to-${range.to}.xlsx`)
    if (tab === 'bs') return exportBlob('/reports/balance-sheet/export', { as_of: asOf }, `cadence-balance-sheet-${asOf}.xlsx`)
    return exportBlob('/reports/pnl/export', { from: range.from, to: range.to, artist: artist || undefined }, `cadence-pnl-${range.from}-to-${range.to}.xlsx`)
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight flex items-center gap-3">Reports <ReconciledBadge /></h1>
          <p className="text-sm text-gray-400">Cash basis, statement-verified{pnl?.reassigned?.count ? ` · ${pnl.reassigned.count} recorded period adjustment${pnl.reassigned.count === 1 ? '' : 's'}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {tab === 'bs' ? (
            <div>
              <label className="label">As of</label>
              <input type="date" className="input !py-1.5" value={asOf} onChange={(e) => { setAsOf(e.target.value); fetchBs(e.target.value) }} />
            </div>
          ) : (
            <>
              <div><label className="label">From</label><input type="date" className="input !py-1.5" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></div>
              <div><label className="label">To</label><input type="date" className="input !py-1.5" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></div>
              {tab === 'pnl' && (
                <div>
                  <label className="label">Artist</label>
                  <select className="input !py-1.5 !w-44" value={artist} onChange={(e) => { setArtist(e.target.value); fetchPnl(range, e.target.value) }}>
                    <option value="">All artists</option>
                    {(pnl?.artists || []).map((a) => <option key={a}>{a}</option>)}
                  </select>
                </div>
              )}
              <button className="btn-primary !py-1.5" onClick={() => fetchPnl()}>Run</button>
            </>
          )}
          <button className="btn-secondary !py-1.5 inline-flex items-center gap-1.5" onClick={exportCurrent}><Download size={14} /> Excel</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 mb-4">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${tab === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            {l}
            {k === 'dismissed' && (pnl?.dismissed?.item_count || pnl?.dismissed?.category_count) ? (
              <span className={tab === k ? 'opacity-80 ml-1' : 'text-gray-400 ml-1'}>{(pnl.dismissed.item_count || 0) + (pnl.dismissed.category_count || 0)}</span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? (
        <div className="card p-10 text-center">
          <AlertTriangle size={28} className="text-warning mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-ink">Couldn't load the report</p>
          <p className="text-xs text-ink-muted mt-1">{error}</p>
          <button className="btn-secondary mt-4 inline-flex items-center gap-1.5" onClick={() => fetchPnl()}><RefreshCw size={14} /> Retry</button>
        </div>
      ) : loading && tab !== 'bs' && tab !== 'dismissed' ? (
        <div className="card p-2"><Skeleton.Table rows={10} cols={8} /></div>
      ) : (
        <>
          {tab === 'pnl' && pnl && (
            <PnlTable pnl={pnl} onDrill={setDrill} refetch={() => fetchPnl()} toast={toast} />
          )}
          {tab === 'artists' && sba && (
            <SpendByArtist data={sba} onDrill={setDrill} />
          )}
          {tab === 'bs' && (
            <BalanceSheetCard bs={bs} error={bsError} refetch={() => fetchBs()} toast={toast} />
          )}
          {tab === 'dismissed' && (
            <DismissedTab toast={toast} onChanged={() => fetchPnl()} />
          )}
        </>
      )}

      {drill && (
        <DrillModal
          drill={drill}
          range={range}
          artist={tab === 'pnl' ? artist : ''}
          pnl={pnl}
          onClose={() => setDrill(null)}
          refetch={() => { fetchPnl(); fetchBs() }}
          toast={toast}
        />
      )}
    </div>
  )
}
