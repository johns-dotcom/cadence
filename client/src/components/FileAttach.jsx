import { useRef, useState } from 'react'
import { Paperclip, Download, Loader2 } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'

// Attach / view a single document for a file-backed resource (NDAs, admin
// docs, …). Uploads to `${base}/${id}/file`, opens via the signed-URL endpoint.
export default function FileAttach({ base, id, fileName, onChange }) {
  const { toast } = useToast()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const upload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await api.post(`${base}/${id}/file`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast('File uploaded'); onChange?.()
    } catch (err) { toast(err.response?.data?.error || 'Upload failed', 'error') }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = '' }
  }

  const open = async () => {
    try { const { data } = await api.get(`${base}/${id}/file`); window.open(data.data.url, '_blank', 'noopener') }
    catch { toast('No file available', 'error') }
  }

  return (
    <div className="flex items-center gap-1.5">
      {fileName && (
        <button onClick={open} title={fileName} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline max-w-[140px] truncate">
          <Download size={12} /> <span className="truncate">{fileName}</span>
        </button>
      )}
      <button onClick={() => inputRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
        {fileName ? 'Replace' : 'Attach'}
      </button>
      <input ref={inputRef} type="file" className="hidden" onChange={upload} />
    </div>
  )
}
