import { useRef, useState } from 'react'
import { Download, Upload, Database } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { dropTarget } from '../utils/drop'

// Workspace-level data tools (admin): full ZIP export + a master-sheet CSV
// importer. The CSV's first column `type` routes each row to the right entity
// (artist | release | expense | income); remaining columns map by header name.
export default function DataTools() {
  const { toast } = useToast()
  const importRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const exportZip = async () => {
    setBusy(true)
    try {
      const res = await api.get('/full-export', { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url; a.download = 'workspace-export.zip'
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
    } catch { toast('Export failed', 'error') }
    finally { setBusy(false) }
  }

  const parseCsv = (text) => {
    const rows = []; let row = []; let field = ''; let q = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (q) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') q = false; else field += c }
      else if (c === '"') q = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n' || c === '\r') { if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = '' } if (c === '\r' && text[i + 1] === '\n') i++ }
      else field += c
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row) }
    if (rows.length < 2) return []
    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    return rows.slice(1).filter(r => r.some(c => c.trim())).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])))
  }

  const onImport = (e) => doImport(e.target.files?.[0])
  const doImport = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const parsed = parseCsv(await file.text())
      const payload = { artists: [], releases: [], expenses: [], income: [] }
      for (const r of parsed) {
        const t = (r.type || '').toLowerCase()
        if (t === 'artist') payload.artists.push(r)
        else if (t === 'release') payload.releases.push(r)
        else if (t === 'expense') payload.expenses.push(r)
        else if (t === 'income') payload.income.push(r)
      }
      const total = payload.artists.length + payload.releases.length + payload.expenses.length + payload.income.length
      if (!total) { toast('No rows with a recognized "type" column', 'error'); return }
      const { data } = await api.post('/import/master-sheet', payload)
      const c = data.data
      toast(`Imported ${c.artists} artists, ${c.releases} releases, ${c.expenses} expenses, ${c.income} income`)
    } catch (err) { toast(err.response?.data?.error || 'Import failed', 'error') }
    finally { setBusy(false); if (importRef.current) importRef.current.value = '' }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1"><Database size={15} className="text-brand-600" /><h2 className="text-sm font-bold text-ink">Data</h2></div>
      <p className="text-xs text-gray-400 mb-4">Export everything in this workspace, or bulk-import from a master sheet.</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={exportZip} disabled={busy} className="btn-secondary"><Download size={15} /> Export workspace (.zip)</button>
        <button onClick={() => importRef.current?.click()} disabled={busy} className="btn-secondary" {...dropTarget(doImport)}><Upload size={15} /> {busy ? 'Working…' : 'Master-sheet import'}</button>
        <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={onImport} />
      </div>
      <p className="text-[11px] text-gray-400 mt-2">CSV needs a <code>type</code> column (artist · release · expense · income) plus the entity's fields as headers.</p>
    </div>
  )
}
