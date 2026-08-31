import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Music, FileText, CheckSquare, Receipt, AtSign, Package, CheckCheck, X } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'

const ICONS = { release: Music, task: CheckSquare, contract: FileText, approval: Receipt, mention: AtSign, bulk_deal: Package }
const SEVERITY = { danger: 'text-red-600 bg-red-50', warning: 'text-amber-600 bg-amber-50', info: 'text-brand-600 bg-brand-500/10' }
const FILTERS = [['all', 'All'], ['mention', 'Mentions'], ['smart', 'Smart alerts']]

export default function Notifications() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  const load = useCallback(() => {
    api.get('/notifications').then(r => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const readMention = async (item, go) => {
    if (item.mentionId) { await api.post('/notifications/mentions/read', { id: item.mentionId }).catch(() => {}) }
    if (go) navigate(item.link); else load()
  }
  const readAllMentions = async () => { try { await api.post('/notifications/mentions/read', {}); toast('Mentions marked read'); load() } catch { toast('Failed', 'error') } }
  const clearAlerts = async () => { try { await api.post('/notifications/clear'); toast('Alerts cleared'); load() } catch { toast('Failed', 'error') } }

  if (loading) return <div><PageHeader title="Notifications" /><div className="card p-6"><Skeleton.Block /></div></div>
  const mentions = data?.mentions || []
  const smart = data?.smart_alerts || []
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''

  const Row = ({ item }) => {
    const Icon = ICONS[item.type] || Bell
    return (
      <button onClick={() => item.type === 'mention' ? readMention(item, true) : navigate(item.link)} className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 text-left border-b border-divider last:border-0">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${SEVERITY[item.severity] || SEVERITY.info}`}><Icon size={15} /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-ink">{item.title}</span>
          <span className="block text-[12px] text-gray-400">{item.detail}{item.date ? ` · ${fmtDate(item.date)}` : ''}</span>
        </span>
        {item.type === 'mention' && <span onClick={(e) => { e.stopPropagation(); readMention(item, false) }} title="Mark read" className="text-gray-300 hover:text-brand-600"><X size={15} /></span>}
      </button>
    )
  }

  const showMentions = filter !== 'smart'
  const showSmart = filter !== 'mention'

  return (
    <div>
      <PageHeader title="Notifications" subtitle="Mentions and smart alerts across your workspace"
        action={<div className="flex items-center gap-2">
          {mentions.length > 0 && <button onClick={readAllMentions} className="btn-secondary"><CheckCheck size={15} /> Mark mentions read</button>}
          {smart.length > 0 && <button onClick={clearAlerts} className="btn-secondary">Clear alerts</button>}
        </div>} />

      <div className="flex items-center gap-1 mb-4">
        {FILTERS.map(([k, lbl]) => (
          <button key={k} onClick={() => setFilter(k)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${filter === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>{lbl}</button>
        ))}
      </div>

      {(!mentions.length && !smart.length) ? (
        <div className="card p-10 text-center"><Bell size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-400">You're all caught up.</p></div>
      ) : (
        <div className="space-y-4">
          {showMentions && mentions.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-2 bg-page/50 border-b border-divider text-[11px] font-semibold uppercase tracking-wide text-gray-400">Mentions</div>
              {mentions.map(m => <Row key={m.key} item={m} />)}
            </div>
          )}
          {showSmart && smart.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-2 bg-page/50 border-b border-divider text-[11px] font-semibold uppercase tracking-wide text-gray-400">Smart alerts</div>
              {smart.map(s => <Row key={s.key} item={s} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
