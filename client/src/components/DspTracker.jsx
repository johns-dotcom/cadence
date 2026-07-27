import { useEffect, useState } from 'react'
import { Radio } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { DSP_STATUSES } from '../constants'

// Per-release DSP submission grid. Reads/writes /api/dsp/:releaseId, which is
// label-scoped and re-validates the release belongs to the workspace.
const STATUS_STYLE = {
  'Not Submitted': 'bg-gray-100 text-gray-500',
  'Submitted':     'bg-amber-100 text-amber-700',
  'Approved':      'bg-blue-100 text-blue-700',
  'Live':          'bg-emerald-100 text-emerald-700',
  'Rejected':      'bg-red-100 text-red-700',
}

export default function DspTracker({ releaseId }) {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/dsp/${releaseId}`).then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }, [releaseId])

  const update = async (platform, patch) => {
    const prev = rows
    const next = rows.map(r => r.platform === platform ? { ...r, ...patch } : r)
    setRows(next)
    const row = next.find(r => r.platform === platform)
    try {
      await api.put(`/dsp/${releaseId}`, { platform, status: row.status, submitted_date: row.submitted_date, live_date: row.live_date, notes: row.notes })
    } catch {
      setRows(prev); toast('Failed to update DSP status', 'error')
    }
  }

  if (loading) return null

  return (
    <div className="card p-5 mt-6">
      <div className="flex items-center gap-2 mb-3">
        <Radio size={15} className="text-brand-600" />
        <h2 className="text-sm font-bold text-ink">DSP submissions</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider">
              <th className="py-2 pr-3 font-semibold">Platform</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 font-semibold">Submitted</th>
              <th className="py-2 pr-3 font-semibold">Live</th>
              <th className="py-2 pr-3 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.platform} className="border-b border-divider last:border-0">
                <td className="py-2 pr-3 font-medium text-ink">{r.platform}</td>
                <td className="py-2 pr-3">
                  <select
                    value={r.status}
                    onChange={e => update(r.platform, { status: e.target.value })}
                    className={`text-xs font-semibold rounded-md px-2 py-1 border-0 cursor-pointer ${STATUS_STYLE[r.status] || STATUS_STYLE['Not Submitted']}`}
                  >
                    {DSP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  <input type="date" value={r.submitted_date ? String(r.submitted_date).slice(0, 10) : ''} onChange={e => update(r.platform, { submitted_date: e.target.value || null })} className="text-xs border border-rule rounded px-1.5 py-1 bg-card text-ink" />
                </td>
                <td className="py-2 pr-3">
                  <input type="date" value={r.live_date ? String(r.live_date).slice(0, 10) : ''} onChange={e => update(r.platform, { live_date: e.target.value || null })} className="text-xs border border-rule rounded px-1.5 py-1 bg-card text-ink" />
                </td>
                <td className="py-2 pr-3 min-w-[160px]">
                  <input
                    defaultValue={r.notes || ''}
                    onBlur={e => { if ((e.target.value || '') !== (r.notes || '')) update(r.platform, { notes: e.target.value || null }) }}
                    placeholder="—"
                    className="w-full text-xs border border-rule rounded px-1.5 py-1 bg-card text-ink"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
