import { useRef, useState } from 'react'
import { UploadCloud, FileText, X } from 'lucide-react'

// Drag-and-drop file picker. Click anywhere to browse, or drop a file onto it.
// Controlled: parent owns the File via `value` + `onChange(file|null)`.
export default function Dropzone({ value, onChange, accept, required }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const pick = (file) => { if (file) onChange(file) }
  const onDrop = (e) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files?.[0]
    pick(file)
  }
  const clear = (e) => { e.stopPropagation(); onChange(null); if (inputRef.current) inputRef.current.value = '' }

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
        : value ? 'border-brand-300 bg-brand-500/10/40'
        : 'border-rule bg-card hover:border-brand-300 hover:bg-gray-50'
      }`}
    >
      {value ? (
        <>
          <FileText size={20} className="text-brand-600" />
          <div className="flex items-center gap-1.5 max-w-full">
            <span className="text-sm font-medium text-ink truncate max-w-[200px]">{value.name}</span>
            <button type="button" onClick={clear} className="text-gray-400 hover:text-red-600 flex-shrink-0" title="Remove">
              <X size={14} />
            </button>
          </div>
          <span className="text-[11px] text-gray-400">Click or drop to replace</span>
        </>
      ) : (
        <>
          <UploadCloud size={20} className={dragging ? 'text-brand-600' : 'text-gray-400'} />
          <span className="text-sm text-gray-600"><span className="font-semibold text-brand-600">Choose a file</span> or drag it here</span>
          <span className="text-[11px] text-gray-400">{accept ? accept.replace(/\./g, '').toUpperCase() : 'PDF, image or document'}{required ? ' · required' : ''}</span>
        </>
      )}
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => pick(e.target.files?.[0] || null)} />
    </div>
  )
}
