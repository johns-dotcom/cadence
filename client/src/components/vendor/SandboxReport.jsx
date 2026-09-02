// The two lab-only surfaces the generated VendorSubmitLab swaps in: the banner
// that says nothing here is real, and the report that replaces the vendor's
// "Invoice received" screen.
//
// Hand-written on purpose. `pages/VendorSubmitLab.jsx` is GENERATED from
// `pages/VendorSubmit.jsx` by `client/scripts/sync-vendor-lab.mjs`, so the
// less bespoke JSX that lives inside the generated file, the fewer anchors
// there are to break when the live form changes.
import { FlaskConical, ShieldCheck, FileText, AlertTriangle, XCircle, ExternalLink } from 'lucide-react'

export function SandboxBanner({ slug }) {
  return (
    <div className="rounded-xl border border-brand-600/40 bg-brand-500/10 px-4 py-3 mb-5">
      <p className="text-xs font-bold text-brand-ink inline-flex items-center gap-1.5 uppercase tracking-wider">
        <FlaskConical size={13} /> Sandbox
      </p>
      <p className="text-[12px] text-ink-muted mt-1">
        This is the real vendor form, wired to a write-nothing endpoint. Nothing you submit here is created —
        no ledger entry, no file upload, no email, no payment record. <span className="font-semibold text-ink">Validation still runs in full</span>,
        so a refusal here is exactly the refusal a vendor would get.
      </p>
      {slug && (
        <a href={`/submit/${slug}`} target="_blank" rel="noopener noreferrer"
          className="text-[12px] font-semibold text-brand-ink hover:underline inline-flex items-center gap-1 mt-1.5">
          Open the live form <ExternalLink size={11} />
        </a>
      )}
    </div>
  )
}

const Row = ({ k, v }) => {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null
  const text = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return (
    <div className="flex items-start gap-3 py-1 border-b border-divider last:border-0">
      <span className="w-52 shrink-0 text-[11px] font-semibold text-ink-faint">{k}</span>
      <span className="flex-1 text-[12px] text-ink break-words">{text}</span>
    </div>
  )
}

export function SandboxReport({ result, onReset }) {
  const w = result?.would_create || {}
  const files = result?.files || []
  const advisories = result?.advisories || []
  const bytes = (n) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

  return (
    <div className="min-h-screen bg-page py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="card p-6">
          <p className="text-xs font-bold text-brand-ink inline-flex items-center gap-1.5 uppercase tracking-wider">
            <ShieldCheck size={13} /> Passed every check · nothing was written
          </p>
          <h1 className="text-lg font-bold text-ink mt-1">
            This submission would have been accepted{result?.workspace ? ` by ${result.workspace}` : ''}
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Every rule a real vendor faces ran against this input. The row below is what the ledger entry
            <span className="font-semibold text-ink"> would </span>look like — it does not exist.
          </p>

          {advisories.length > 0 && (
            <div className="mt-4 rounded-lg border border-warning/40 bg-brand-500/10 px-3 py-2.5">
              <p className="text-[11px] font-bold text-warning uppercase tracking-wider inline-flex items-center gap-1.5">
                <AlertTriangle size={12} /> The approver would also see
              </p>
              <ul className="mt-1 space-y-1">
                {advisories.map((a, i) => <li key={i} className="text-[12px] text-ink-muted">· {a}</li>)}
              </ul>
            </div>
          )}

          <h2 className="text-xs font-bold text-ink uppercase tracking-wider mt-5 mb-1">Would create</h2>
          <div className="rounded-lg border border-rule px-3 py-1">
            <Row k="table" v={w.table} />
            <Row k="status" v={`${w.status} · ${w.payment_status}`} />
            <Row k="payee / vendor_name" v={w.payee} />
            <Row k="vendor_email" v={w.vendor_email} />
            <Row k="vendor_address" v={w.vendor_address} />
            <Row k="invoice_number" v={w.invoice_number} />
            <Row k="amount" v={`${w.currency} ${Number(w.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
            <Row k="category" v={w.category} />
            <Row k="artist / song" v={[w.artist, w.song].filter(Boolean).join(' — ')} />
            <Row k="rep" v={w.rep} />
            <Row k="is_reimbursement" v={String(!!w.is_reimbursement)} />
            <Row k="payment_terms" v={`${w.payment_terms} · scheduled ${w.scheduled_payment_date}`} />
            <Row k="payment_method" v={w.payment_method} />
            <Row k="payment_last4" v={w.payment_last4 ? `${w.payment_last4} (withheld — the sandbox never echoes coordinates)` : null} />
            <Row k="payment_check.verdict" v={w.payment_check?.verdict} />
            <Row k="off_roster_artist" v={String(!!w.off_roster_artist)} />
            <Row k="description" v={w.description} />
            <Row k="notes" v={w.notes} />
            <Row k="social_handles" v={w.social_handles} />
            <Row k="artist_breakdown" v={w.artist_breakdown} />
          </div>

          {files.length > 0 && (
            <>
              <h2 className="text-xs font-bold text-ink uppercase tracking-wider mt-5 mb-1">Files read, not stored</h2>
              <div className="space-y-1">
                {files.map(f => (
                  <div key={f.field} className="flex items-center gap-2 text-[12px] text-ink-muted">
                    <FileText size={13} className="text-ink-faint" />
                    <span className="font-semibold text-ink">{f.name}</span>
                    <span className="text-ink-faint">{f.field} · {bytes(f.bytes)} · {f.mime}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h2 className="text-xs font-bold text-ink uppercase tracking-wider mt-5 mb-1">Not exercised</h2>
          <p className="text-[11px] text-ink-faint mb-1.5">
            A green result here is not proof the whole pipeline works — these steps never ran.
          </p>
          <ul className="space-y-1">
            {(result?.not_exercised || []).map((n, i) => (
              <li key={i} className="text-[12px] text-ink-muted inline-flex items-start gap-1.5">
                <XCircle size={12} className="text-ink-faint mt-0.5 shrink-0" /> {n}
              </li>
            ))}
          </ul>

          <button onClick={onReset} className="btn-secondary mt-6">Run another dry run</button>
        </div>
      </div>
    </div>
  )
}

export default SandboxReport
