import { useEffect, useState } from 'react'
import { Building2, Info } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'

// The label's own record — who this workspace is on paper.
//
// Replaces the old "Invoice details" form. Same remittance fields, one extra
// group (who signs, and the default payment terms), and a different store:
// `label_records` rather than loose JSON on `labels.invoice_settings`.
//
// ── The warning at the top is the important part of this component ──
// Everything in the remittance groups is PRINTED on every invoice this
// workspace issues, the EIN and the account number included. People filling in
// a settings form do not assume that; they assume a settings form is internal.
// So the banner says it before the first field rather than after the save.
//
// There is no masking and no reveal button here for the same reason: a field
// whose value is on a PDF that goes to clients is not a secret from the person
// who sends the PDF. See server/routes/label-record.js for why this diverges
// from the vendor payment vault, which IS masked.
const GROUPS = [
  {
    title: 'Company',
    note: 'The top of the “Funds payable to” block.',
    fields: [
      { key: 'company_name', label: 'Company legal name', wide: true, placeholder: 'BOOM.RECORDS LLC' },
      { key: 'address', label: 'Address', wide: true, textarea: true, placeholder: '1119 POINSETTIA DRIVE\nUNIT 01\nLOS ANGELES CA 90046-5794 USA' },
      { key: 'contact', label: 'Contact name', placeholder: 'JOHN SKEAD' },
      { key: 'ein', label: 'EIN / Tax ID', placeholder: '87-1095996' },
      { key: 'phone', label: 'Phone', placeholder: '201-912-3991' },
      { key: 'email', label: 'Email', placeholder: 'billing@example.com' },
      { key: 'website', label: 'Website', placeholder: 'example.com' },
    ],
  },
  {
    title: 'Bank',
    note: 'How clients pay this label.',
    fields: [
      { key: 'bank_name', label: 'Bank name', placeholder: 'BANK OF AMERICA' },
      { key: 'bank_address', label: 'Bank address', placeholder: 'PO BOX 25118, TAMPA FL 33622-5118' },
      { key: 'account_name', label: 'Account name', placeholder: 'BOOM.RECORDS LLC' },
      { key: 'account_type', label: 'Account type', placeholder: 'CHECKING' },
      { key: 'swift', label: 'SWIFT', placeholder: 'BOFAUS3N' },
      { key: 'routing', label: 'Routing (wire)', placeholder: '026009593' },
      { key: 'routing_ach', label: 'Routing (ACH)', placeholder: '122000661' },
      { key: 'account_number', label: 'Account number', wide: true, placeholder: '325146889268' },
    ],
  },
  {
    title: 'Signatory',
    // These are new with the record. Nothing consumes them yet — the contract
    // and waiver surfaces that will are a later milestone — so the note says
    // so rather than implying a document is already being stamped with them.
    note: 'Who signs on behalf of the label. Used to pre-fill contracts and waivers.',
    fields: [
      { key: 'signatory_name', label: 'Name', placeholder: 'JOHN SKEAD' },
      { key: 'signatory_title', label: 'Title', placeholder: 'Managing Director' },
      { key: 'signatory_email', label: 'Email', wide: true, placeholder: 'signing@example.com' },
    ],
  },
]

export default function LabelRecordForm() {
  const { toast } = useToast()
  const [rec, setRec] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/label-record')
      .then(r => setRec(r.data.data || {}))
      .catch(() => toast('Could not load the label record', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const set = (k) => (e) => setRec(s => ({ ...s, [k]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      // Send only what the form owns. Spreading the whole row back would
      // return `updated_by`/`updated_at` as if they were editable fields.
      const payload = {}
      for (const g of GROUPS) for (const f of g.fields) payload[f.key] = rec[f.key] ?? ''
      payload.payment_terms = rec.payment_terms ?? ''
      const { data } = await api.patch('/label-record', payload)
      setRec(data.data)
      toast('Label record saved')
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save', 'error')
    } finally { setSaving(false) }
  }

  if (loading) return <div className="card p-5 text-sm text-ink-muted">Loading the label record…</div>

  return (
    <form onSubmit={save} className="card p-5">
      <h2 className="mb-1 inline-flex items-center gap-1.5 text-sm font-bold text-ink">
        <Building2 size={15} /> Label record
      </h2>
      <p className="mb-4 text-xs text-ink-muted">
        Who this workspace is on paper. One record, used everywhere the label has to identify itself.
      </p>

      <div className="mb-5 flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-ink-muted">
        <Info size={14} className="mt-0.5 flex-shrink-0 text-info" />
        <span>
          The <strong className="text-ink">Company</strong> and <strong className="text-ink">Bank</strong> details below are
          printed on every invoice this workspace issues — the tax ID and account number included. Treat them as
          published, not private.
        </span>
      </div>

      <div className="space-y-6">
        {GROUPS.map(g => (
          <div key={g.title}>
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-widest text-ink-faint">{g.title}</p>
            <p className="mb-2 text-xs text-ink-muted">{g.note}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {g.fields.map(f => (
                <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
                  <label className="label" htmlFor={`lr-${f.key}`}>{f.label}</label>
                  {f.textarea ? (
                    <textarea id={`lr-${f.key}`} className="input min-h-[64px]" value={rec[f.key] || ''} onChange={set(f.key)} placeholder={f.placeholder} />
                  ) : (
                    <input id={`lr-${f.key}`} className="input" value={rec[f.key] || ''} onChange={set(f.key)} placeholder={f.placeholder} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Payment terms</p>
          <div className="max-w-[12rem]">
            <label className="label" htmlFor="lr-payment_terms">Default terms</label>
            <input id="lr-payment_terms" className="input" value={rec.payment_terms || ''} onChange={set('payment_terms')} placeholder="Net 30" />
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-divider pt-4">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : 'Save label record'}
        </button>
        {rec.updated_at && (
          <span className="text-xs text-ink-faint">
            Last changed {formatDate(rec.updated_at)}{rec.updated_by_name ? ` by ${rec.updated_by_name}` : ''}
          </span>
        )}
      </div>
    </form>
  )
}
