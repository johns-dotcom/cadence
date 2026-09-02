import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, Copy, Users } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { money, moneyByCurrency } from '../utils/money'
import { formatDate } from '../utils/dates'

// Added-expense vendors — the invoice-less side of the vendor world.
//
// These payees exist only because somebody added an expense on Recoupments or
// Artist Campaigns. Those rows carry no invoice number, so the ledger's
// duplicate-invoice gate has nothing to key on: the same payment can be
// entered twice and a creator's total climbs with nobody noticing. This page
// is the substitute check — same payee, same amount, same week.
//
// Rows converted into Creator Payments leave this population by entry_source,
// which is correct: a creator payment is a deliberate record with its own
// directory and its own 1099 exposure.

const BAND = {
  high: ['High', 'bg-red-100 text-red-700'],
  watch: ['Watch', 'bg-amber-100 text-amber-700'],
  ok: ['OK', 'bg-elev text-ink-muted'],
}

export default function VendorsAdded() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/ledger/vendors/added-expenses')
      .then((r) => { setData(r.data.data); setError(null) })
      .catch((e) => setError(e.response?.data?.error || 'Could not load added expenses'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const vendors = data?.vendors || []
  const dupes = data?.dupePairs || []
  const variants = data?.nameVariants || []
  const items = vendors.reduce((n, v) => n + v.items, 0)
  const totalUsd = vendors.reduce((n, v) => n + v.usd, 0)

  return (
    <div>
      <Link to="/vendors" className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink mb-2">
        <ArrowLeft size={13} /> All vendors
      </Link>
      <PageHeader
        title="Added-expense vendors"
        subtitle="Payees created by adding an expense on Recoupments or Artist Campaigns. They have no invoice number, so nothing structural stops the same payment being entered twice."
      />

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={8} cols={6} /></div>
      ) : error ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-danger mb-3">{error}</p>
          <button onClick={load} className="btn-secondary mx-auto">Retry</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              ['Vendors', vendors.length, null],
              ['Items', items, null],
              ['Total ≈USD', money(totalUsd), null],
              ['Possible duplicates', dupes.length, dupes.length > 0],
            ].map(([label, value, warn]) => (
              <div key={label} className={`card p-4 ${warn ? 'bg-amber-500/10' : ''}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{label}</p>
                <p className={`text-xl font-bold tabular-nums ${warn ? 'text-warning' : 'text-ink'}`}>{value}</p>
              </div>
            ))}
          </div>

          {dupes.length > 0 && (
            <div className="card p-4 mb-4">
              <p className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5">
                <Copy size={14} className="text-warning" /> Possible duplicate entries ({dupes.length})
              </p>
              <p className="text-[11px] text-ink-faint mb-2">
                The same payee for the same amount within a week. Open both on the ledger and delete the one that was entered twice — or leave them if the creator really was paid twice.
              </p>
              <div className="space-y-2">
                {dupes.map((d, i) => (
                  <div key={i} className="border-t border-divider pt-2 text-sm">
                    <p className="font-medium text-ink">
                      {d.payee} · {d.currency} {Number(d.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} × 2
                      <span className="text-ink-faint font-normal"> · {d.days_apart} day{d.days_apart === 1 ? '' : 's'} apart</span>
                    </p>
                    <div className="grid sm:grid-cols-2 gap-1 mt-1">
                      {[d.a, d.b].map((side) => (
                        <Link key={side.id} to={`/ledger?focus=${side.id}`}
                          className="text-xs text-ink-muted hover:bg-elev rounded px-1.5 py-1 border border-divider">
                          {formatDate(side.date)} · {side.artist || 'no artist'}{side.song ? ` · ${side.song}` : ''}
                          <span className="text-brand-ink"> · review →</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {variants.length > 0 && (
            <div className="card p-4 mb-4">
              <p className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5">
                <Users size={14} /> One creator, several spellings ({variants.length})
              </p>
              <p className="text-[11px] text-ink-faint mb-2">
                These already roll up together here, but they are separate payees everywhere else. Merge or rename them on the vendor page so every total agrees.
              </p>
              <div className="space-y-1.5">
                {variants.map((v) => (
                  <div key={v.key} className="text-xs border-t border-divider pt-1.5">
                    {v.spellings.map((s) => (
                      <Link key={s} to={`/vendors?vendor=${encodeURIComponent(s)}`}
                        className="inline-block mr-1.5 mb-1 px-2 py-0.5 rounded border border-rule bg-elev text-ink-muted hover:text-ink">
                        {s}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {vendors.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="text-sm text-ink-muted">No added expenses on file yet. They appear when somebody adds an expense from Recoupments or Artist Campaigns.</p>
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-divider text-left">
                    {['Vendor / creator', 'Items', 'Artists', 'Last activity', 'Total', '≈USD', 'Level'].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] font-extrabold text-ink-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {vendors.map((v) => (
                    <tr key={v.key} className="hover:bg-elev">
                      <td className="px-4 py-3">
                        <Link to={`/vendors?vendor=${encodeURIComponent(v.name)}`} className="font-medium text-ink hover:underline">{v.name}</Link>
                        {v.spellings.length > 1 && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-elev border border-rule text-ink-faint">
                            +{v.spellings.length - 1} spelling{v.spellings.length === 2 ? '' : 's'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-muted tabular-nums">{v.items}</td>
                      <td className="px-4 py-3 text-ink-muted text-xs">
                        {v.artists.slice(0, 3).join(', ') || <span className="text-ink-faint">—</span>}
                        {v.artists.length > 3 && <span className="text-ink-faint"> +{v.artists.length - 3}</span>}
                      </td>
                      <td className="px-4 py-3 text-ink-muted text-xs whitespace-nowrap">{formatDate(v.last_date)}</td>
                      <td className="px-4 py-3 text-ink-muted text-xs whitespace-nowrap tabular-nums">{moneyByCurrency(v.totals)}</td>
                      <td className="px-4 py-3 text-ink font-medium tabular-nums">{money(v.usd)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${BAND[v.band][1]}`}>{BAND[v.band][0]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-ink-faint mt-2">
            Level is a fixed USD-equivalent band — Watch from $1,000, High from $5,000 — not a percentile, so it means the same thing in every workspace.
          </p>
        </>
      )}
    </div>
  )
}
