import { useState } from 'react'
import { ArrowRight, Loader } from 'lucide-react'

// Say what a campaign cost; the page works out which charges funded it.
//
// Campaign-led because it is the only unit anybody actually knows: nothing on a
// Facebook charge says which campaign it paid for, but a person knows what a
// campaign was worth.
//
// ── Preview before write, always ──
// The preview is the SAME server call with dry_run: true, so what is approved is
// what gets written. A client-side estimate of a server calculation is a preview
// that can disagree with the result, and this page's whole safety story is that
// it cannot.

const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (d) => String(d || '').slice(0, 10)

export default function AllocatePanel({
  campaigns = [], openDollars = 0, busy = false, preview = null, error = '',
  onPreview, onApply, onCancel,
}) {
  const [campaignId, setCampaignId] = useState('')
  const [amount, setAmount] = useState('')

  const camp = campaigns.find((c) => String(c.id) === String(campaignId))
  const amt = Number(String(amount).replace(/[^0-9.]/g, '')) || 0
  const canPreview = !!camp && !!camp.artist && amt > 0 && !busy

  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label className="block text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1">Campaign</label>
          <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); onCancel?.() }} className="input !py-1.5 text-[13px] w-full">
            <option value="">Choose a campaign…</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.artist || 'no artist'}{c.song ? ` · ${c.song}` : ''} — {c.name}
              </option>
            ))}
          </select>
          {camp && !camp.artist && (
            <p className="text-[11px] text-danger mt-1">This campaign has no artist, so allocating to it would attribute nothing.</p>
          )}
        </div>

        <div className="w-32">
          <label className="block text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1">Spent</label>
          <input value={amount} onChange={(e) => { setAmount(e.target.value); onCancel?.() }}
            placeholder="0.00" inputMode="decimal" className="input !py-1.5 text-[13px] w-full tabular-nums" />
        </div>

        <button onClick={() => onPreview?.({ campaign_id: Number(campaignId), amount: amt })} disabled={!canPreview}
          className="btn-primary !py-1.5 text-[13px] disabled:opacity-40">
          {busy ? <Loader size={13} className="animate-spin" /> : 'Preview'}
        </button>

        <span className="text-[12px] text-ink-faint ml-auto tabular-nums">
          {usd(openDollars)} unallocated this month{camp?.planned_budget ? ` · planned ${usd(camp.planned_budget)}` : ''}
        </span>
      </div>

      {error && <div className="mt-2 text-[12px] text-danger bg-rose-500/10 border-l-2 border-l-danger px-2.5 py-1.5">{error}</div>}

      {preview && (
        <div className="mt-3 border-t border-divider pt-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted mb-2">
            <strong className="text-ink">{usd(preview.total)}</strong>
            <span>drawn from {preview.per_charge.length} charge{preview.per_charge.length === 1 ? '' : 's'}, oldest first</span>
            <ArrowRight size={12} className="text-ink-faint" />
            <span>{usd(preview.open_after)} left unallocated</span>
          </div>
          <div className="rounded-lg border border-rule overflow-hidden">
            {preview.per_charge.map((c) => (
              <div key={c.root_id} className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] border-b border-divider last:border-0">
                <span className="text-ink-muted tabular-nums">{day(c.date)}</span>
                <span className="text-ink truncate">{c.payee}</span>
                <span className="ml-auto tabular-nums text-ink-faint">{usd(c.charge)}</span>
                <span className="tabular-nums font-semibold text-ink w-24 text-right">{usd(c.allocating)}</span>
                <span className="tabular-nums text-ink-faint w-24 text-right">
                  {c.whole_charge ? 'all of it' : `${usd(c.open_after)} left`}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <button onClick={onApply} disabled={busy} className="btn-primary !py-1.5 text-[13px] disabled:opacity-40">
              {busy ? 'Writing…' : 'Apply — write the ledger splits'}
            </button>
            <button onClick={onCancel} className="text-[12px] text-ink-faint hover:text-ink">Cancel</button>
            <span className="text-[11px] text-ink-faint ml-1">
              Each slice is marked reviewed and recoupable, so it reaches Recoupments.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
