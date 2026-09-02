import { useRef, useState } from 'react'
import { Download, Upload, Database, ShieldAlert } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import Modal from './ui/Modal'
import { dropTarget } from '../utils/drop'

// Workspace-level data tools (admin): full ZIP export + a master-sheet CSV
// importer. The CSV's first column `type` routes each row to the right entity
// (artist | release | expense | income); remaining columns map by header name.
export default function DataTools() {
  const { toast } = useToast()
  const { user } = useAuth()
  const importRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [summary, setSummary] = useState(null)
  const [includeFiles, setIncludeFiles] = useState(true)
  const [exporting, setExporting] = useState(false)
  const isSuperadmin = user?.role === 'Superadmin'

  const openExport = async () => {
    setConfirmOpen(true)
    setSummary(null)
    try { const { data } = await api.get('/full-export/summary'); setSummary(data.data) }
    catch (err) { toast(err.response?.data?.error || 'Could not read the workspace summary', 'error'); setConfirmOpen(false) }
  }

  const exportZip = async () => {
    setExporting(true)
    try {
      // Still a blob: downloads carry the Authorization header, so an anchor
      // navigation can't authenticate. The SERVER is what got fixed — it now
      // streams the archive instead of assembling it in memory, so the multi-GB
      // failure mode is one side's problem rather than both.
      const res = await api.get('/full-export', { params: { files: includeFiles ? 1 : 0 }, responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url; a.download = 'workspace-export.zip'
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
      setConfirmOpen(false)
    } catch { toast('Export failed', 'error') }
    finally { setExporting(false) }
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
        <button onClick={openExport} disabled={busy || !isSuperadmin} title={isSuperadmin ? '' : 'Only a Superadmin can export the whole workspace'} className="btn-secondary"><Download size={15} /> Export workspace (.zip)</button>
        <button onClick={() => importRef.current?.click()} disabled={busy} className="btn-secondary" {...dropTarget(doImport)}><Upload size={15} /> {busy ? 'Working…' : 'Master-sheet import'}</button>
        <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={onImport} />
      </div>
      <p className="text-[11px] text-gray-400 mt-2">CSV needs a <code>type</code> column (artist · release · expense · income) plus the entity's fields as headers.</p>
      {!isSuperadmin && <p className="text-[11px] text-ink-faint mt-1">Exporting the whole workspace is Superadmin-only.</p>}

      <Modal
        open={confirmOpen}
        onClose={() => !exporting && setConfirmOpen(false)}
        title="Export this workspace"
        size="lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setConfirmOpen(false)} disabled={exporting}>Cancel</button>
            <button className="btn-primary" onClick={exportZip} disabled={exporting || !summary}>
              {exporting ? 'Preparing your archive…' : 'Download archive'}
            </button>
          </>
        }
      >
        {!summary ? (
          <p className="text-sm text-ink-muted">Reading what's in this workspace…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
              <ShieldAlert size={16} className="text-warning flex-shrink-0 mt-0.5" />
              <p className="text-xs text-warning">
                <strong>Confidential.</strong> The archive contains contracts, bank and remittance details, W9s and
                every uploaded invoice. It is not encrypted — store it somewhere you would store the originals.
              </p>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-2">What you'll get</p>
              <ol className="space-y-1.5 text-sm text-ink-muted list-decimal list-inside">
                <li><strong className="text-ink">{summary.tables} CSV files</strong> — {summary.total_rows.toLocaleString()} rows across the ledger, catalog, contracts, tasks and finance tables.</li>
                <li><strong className="text-ink">{summary.workbooks.length} Excel workbooks</strong> — {summary.workbooks.join(', ')} — the same rows, formatted to open and read.</li>
                <li><strong className="text-ink">{summary.files.toLocaleString()} uploaded documents</strong> — invoices, receipts, payment proofs, W9s and attachments, in named folders.</li>
                <li>A <strong className="text-ink">README</strong> manifest with per-section counts and anything that could not be retrieved.</li>
              </ol>
            </div>

            <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={includeFiles} onChange={e => setIncludeFiles(e.target.checked)} />
              <span>
                Include the {summary.files.toLocaleString()} uploaded documents
                <span className="block text-[11px] text-ink-faint">
                  Unticking gives you the data only — much smaller, and much faster if you just want the numbers.
                </span>
              </span>
            </label>

            {includeFiles && summary.files > 200 && (
              <p className="text-[11px] text-ink-faint">
                With documents included this archive can run to several gigabytes and take a few minutes. Keep this tab
                open until the download starts.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
