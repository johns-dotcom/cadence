import { useRef, useState } from 'react'
import { UploadCloud, FileText, X } from 'lucide-react'

// Drag-and-drop file picker. Click anywhere to browse, or drop a file onto it.
// Controlled: parent owns the File via `value` + `onChange(file|null)`; with
// `multiple`, onChange receives an ARRAY of files instead. The `accept` list
// is enforced on the DROP path too — the native input filters the picker, but
// nothing used to stop a .docx being dragged straight in.
export default function Dropzone({ value, onChange, accept, required, label, hint, multiple }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [typeError, setTypeError] = useState(false)

  const matchesAccept = (file) => {
    if (!accept || !file) return true
    const type = (file.type || '').toLowerCase()
    const name = (file.name || '').toLowerCase()
    return accept.split(',').some((a) => {
      const spec = a.trim().toLowerCase()
      if (!spec) return false
      if (spec.endsWith('/*')) return type.startsWith(spec.slice(0, -1))
      if (spec.startsWith('.')) return name.endsWith(spec)
      return type === spec
    })
  }
  const pick = (fileList) => {
    const all = Array.from(fileList || []).filter(Boolean)
    if (!all.length) return
    const ok = all.filter(matchesAccept)
    setTypeError(ok.length !== all.length)
    if (!ok.length) return
    onChange(multiple ? ok : ok[0])
  }
  const onDrop = (e) => {
    e.preventDefault(); setDragging(false)
    pick(e.dataTransfer.files)
  }
  const clear = (e) => { e.stopPropagation(); setTypeError(false); onChange(null); if (inputRef.current) inputRef.current.value = '' }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center gap-1.5 w-full px-4 py-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors text-center ${
        dragging ? 'border-brand-500 bg-brand-500/10'
        : value ? 'border-brand-300 bg-brand-500/10'
        : 'border-rule bg-card hover:border-brand-300 hover:bg-page/60'
      }`}
    >
      {value ? (
        <>
          <FileText size={20} className="text-brand-600" />
          <div className="flex items-center gap-1.5 max-w-full">
            <span className="text-sm font-medium text-ink truncate max-w-[200px]">{value.name}</span>
            <button type="button" onClick={clear} className="text-ink-faint hover:text-danger flex-shrink-0" title="Remove">
              <X size={14} />
            </button>
          </div>
          <span className="text-[11px] text-ink-faint">Click or drop to replace</span>
        </>
      ) : (
        <>
          <UploadCloud size={20} className={dragging ? 'text-brand-600' : 'text-ink-faint'} />
          <span className="text-sm text-ink-muted">{label || <><span className="font-semibold text-brand-600">Choose a file</span> or drag it here</>}</span>
          <span className="text-[11px] text-ink-faint">{hint || (accept ? accept.replace(/\./g, '').toUpperCase() : 'PDF, image or document')}{required ? ' · required' : ''}</span>
        </>
      )}
      {typeError && <span className="text-[11px] font-semibold text-danger">That file type isn't accepted — {hint || 'PDF or image only'}.</span>}
      <input ref={inputRef} type="file" accept={accept} multiple={multiple || undefined} className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
    </div>
  )
}
