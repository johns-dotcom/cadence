import { useState } from 'react'
import { Check, Wand2 } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import {
  resolveColors, suggestColor, separation,
  PALETTE, PALETTE_NAMES, isHexColor, normalizeHex, DE_FLOOR,
} from '../utils/workspaceColor'

// The one colour editor for the operator console — used by the calendar legend,
// the Workspaces list and the workspace drawer. A second copy is how two
// surfaces end up disagreeing about what "distinct" means, and the whole point
// of this control is that it MEASURES rather than guesses.
//
// `field` decides which column it writes:
//   accent_color  — the workspace's own brand, and the console's default
//   console_color — an override that applies in the console only
// One field at a time, deliberately: a single panel offering both invites
// picking a brand colour while a toggle is silently set to the override.
export default function WorkspaceColorPicker({
  workspace,            // { id, name, accent_color, console_color }
  workspaces = [],      // the roster, for the distinctness measurement
  field = 'accent_color',
  theme = 'light',
  onSaved,              // (patch) => void — patch is { [field]: value|null }
}) {
  const { toast } = useToast()
  const isBrand = field === 'accent_color'
  const current = normalizeHex(workspace?.[field])
  const [hex, setHex] = useState(current || '')
  const [saving, setSaving] = useState(false)

  const steps = PALETTE[theme === 'dark' ? 'dark' : 'light']
  // Measure against what the console ACTUALLY shows for everyone else — the
  // resolved colour, not their raw accent, or the readout would be about a
  // colour nobody is looking at.
  const resolved = resolveColors(workspaces, theme)
  const others = workspaces.filter(w => Number(w.id) !== Number(workspace?.id))

  const save = async (value) => {
    setSaving(true)
    try {
      await api.put(`/platform/workspaces/${workspace.id}/colors`, { [field]: value })
      onSaved?.({ [field]: value })
    } catch (err) {
      toast(err.response?.data?.error || 'Could not save that colour', 'error')
    } finally { setSaving(false) }
  }

  // The consequence of a choice, stated before it is made.
  const verdict = (candidate) => {
    const c = normalizeHex(candidate)
    if (!c || !others.length) return null
    const worst = others
      .map(w => ({ w, s: separation(c, resolved.get(Number(w.id))?.color) }))
      .sort((a, b) => Math.min(a.s.normal / DE_FLOOR, a.s.cvd / 8) - Math.min(b.s.normal / DE_FLOOR, b.s.cvd / 8))[0]
    return worst
  }
  const preview = isHexColor(hex) ? verdict(hex) : null

  return (
    <div className="p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint mb-2">
        {isBrand ? 'Brand colour' : 'Console colour'}
      </p>

      <div className="grid grid-cols-4 gap-1.5">
        {steps.map((swatch, i) => (
          <button
            key={swatch}
            onClick={() => save(swatch)}
            disabled={saving}
            title={PALETTE_NAMES[i]}
            className="h-7 rounded-md ring-1 ring-inset ring-black/10 flex items-center justify-center disabled:opacity-50"
            style={{ background: swatch }}
          >
            {current === swatch && <Check size={13} className="text-white drop-shadow" />}
          </button>
        ))}
      </div>

      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-3 mb-1.5">Custom</p>
      <div className="flex items-center gap-1.5">
        <input
          value={hex}
          onChange={e => setHex(e.target.value)}
          placeholder="#2a78d6"
          className="input !py-1 text-xs font-mono flex-1"
        />
        <button
          onClick={() => save(normalizeHex(hex))}
          disabled={saving || !isHexColor(hex)}
          className="btn-primary !py-1 !px-2.5 text-xs disabled:opacity-40"
        >Set</button>
      </div>

      {preview && (
        <p className={`text-[10px] mt-1.5 ${preview.s.ok ? 'text-ink-faint' : 'text-warning'}`}>
          {preview.s.ok ? 'Clearly distinct from ' : 'Too close to '}{preview.w.name}
          {' '}(ΔE {preview.s.normal.toFixed(1)}, colourblind {preview.s.cvd.toFixed(1)})
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-2.5 border-t border-divider">
        <button
          onClick={() => save(suggestColor(workspace.id, workspaces, resolved, theme))}
          disabled={saving}
          className="text-[11px] font-semibold text-brand-ink hover:underline inline-flex items-center gap-1 disabled:opacity-50"
        >
          <Wand2 size={11} /> Pick the most distinct
        </button>
        {/* Clearing means different things for the two fields, so it says which
            — "reset" that silently meant "auto-assign" would be a lie. */}
        {current && (
          <button
            onClick={() => save(null)}
            disabled={saving}
            className="text-[11px] font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
          >
            {isBrand
              ? 'Clear'
              : workspace?.accent_color ? 'Use brand colour' : 'Clear override'}
          </button>
        )}
      </div>

      <p className="text-[10px] text-ink-faint mt-2">
        {isBrand
          ? 'Used by the workspace itself, and the default everywhere in this console.'
          : 'Applies in this console only — the workspace keeps its own brand colour.'}
      </p>
    </div>
  )
}
