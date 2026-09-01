import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import { Check, Clock, Pencil, Save, Archive, RotateCcw, Trash2, Library, User, ExternalLink } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import {
  RELEASE_TYPES, RELEASE_STATUSES, RELEASE_CHECKLIST, RELEASE_CHECKLIST_GROUPS,
  PRIORITIES, GENRE_OPTIONS, COVER_ART_STATUSES,
} from '../constants'
import { formatDate } from '../utils/dates'
import DspTracker from './DspTracker'
import ReleaseExtras from './ReleaseExtras'
import { ConfirmDialog, Badge } from './ui'
import { countdownOf, priorityToneOf, spotifyUrl } from '../utils/releases'

// The 7-tab release workspace. ONE implementation, mounted two ways:
//   • inline, inside an expanded row of the Releases list (`variant="inline"`)
//   • as the body of the /releases/:id detail page (`variant="page"`)
// Keeping it in one component is what stops the list and the detail page from
// drifting apart — every tab, every save path and every guard is shared.
//
// The parent owns the release object and applies server responses via
// `onPatched(updatedRelease)`, so an inline edit updates the row behind the
// workspace without a refetch.

export const TABS = [
  { id: 'checklist', label: 'Checklist' },
  { id: 'metadata', label: 'Metadata & Links' },
  { id: 'dsp', label: 'DSP' },
  { id: 'budget', label: 'Budget' },
  { id: 'activity', label: 'Activity' },
  { id: 'comments', label: 'Comments' },
  { id: 'details', label: 'Details' },
]
export const TAB_IDS = TABS.map(t => t.id)

const LABELS = Object.fromEntries(RELEASE_CHECKLIST.map(c => [c.key, c.label]))

export default function ReleaseWorkspace({
  release, tab, onTabChange, onPatched, onRemoved, onDirtyChange,
  artists = [], members = [], variant = 'inline',
}) {
  const { toast } = useToast()
  const { user } = useAuth()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const canAssign = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)
  const id = release.id

  const patch = useCallback(async (fields) => {
    try {
      const { data } = await api.patch(`/releases/${id}`, fields)
      onPatched(data.data)
      return data.data
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save', 'error')
      return null
    }
  }, [id, onPatched, toast])

  const done = RELEASE_CHECKLIST.filter(c => release[c.key]).length
  const total = RELEASE_CHECKLIST.length
  const pct = Math.round((done / total) * 100)

  return (
    <div>
      <WorkspaceHeader release={release} done={done} total={total} pct={pct} variant={variant} />

      {/* Tab strip — horizontally scrollable so all 7 stay reachable on phones.
          The number hint doubles as the 1–7 hotkey. */}
      <div
        className={`flex items-center gap-1 overflow-x-auto border-b border-divider ${variant === 'inline' ? 'px-4 sm:px-6' : 'mb-5 -mx-1 px-1'}`}
        style={{ WebkitOverflowScrolling: 'touch' }}
        onClick={e => e.stopPropagation()}
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition ${
              tab === t.id ? 'border-brand-600 text-brand-ink' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
            {t.id === 'checklist' && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold tabular-nums ${tab === t.id ? 'bg-brand-500/15 text-brand-ink' : 'bg-gray-100 text-ink-faint'}`}>
                {done}/{total}
              </span>
            )}
            <span className="text-[10px] text-ink-faint">{i + 1}</span>
          </button>
        ))}
      </div>

      <div className={variant === 'inline' ? 'p-4 sm:p-6' : ''} onClick={e => e.stopPropagation()}>
        {tab === 'checklist' && <ChecklistTab release={release} patch={patch} onPatched={onPatched} />}
        {tab === 'metadata' && <MetadataTab release={release} patch={patch} onDirtyChange={onDirtyChange} />}
        {tab === 'dsp' && <DspTracker releaseId={id} bare />}
        {tab === 'budget' && (
          <ReleaseExtras
            releaseId={id}
            budgetCap={release.budget_cap}
            onCapChange={(v) => patch({ budget_cap: v === '' ? null : v })}
            section="budget"
            bare
          />
        )}
        {tab === 'activity' && <ActivityTab releaseId={id} />}
        {tab === 'comments' && <ReleaseExtras releaseId={id} section="comments" bare />}
        {tab === 'details' && (
          <DetailsTab
            release={release} patch={patch} onPatched={onPatched} onRemoved={onRemoved}
            artists={artists} members={members} isAdmin={isAdmin} canAssign={canAssign}
          />
        )}
      </div>
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────────
// Title, artist, priority badge, meta line with the colour-coded countdown,
// and the big completion figure + progress ring.
function WorkspaceHeader({ release, done, total, pct, variant }) {
  const cd = countdownOf(release.release_date)
  const tone = priorityToneOf(release)
  return (
    <div className={`flex items-start justify-between gap-4 flex-wrap ${variant === 'inline' ? 'px-4 sm:px-6 py-4 border-b border-divider' : 'mb-5'}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2.5 mb-1 flex-wrap">
          <Link
            to={`/releases/${release.id}`}
            onClick={e => e.stopPropagation()}
            className="text-ink font-bold text-base tracking-tight hover:text-brand-ink transition-colors"
          >
            {release.project_name}
          </Link>
          <span className="text-ink-muted text-sm">{release.artist_name || 'Unassigned'}</span>
          {tone && <Badge tone={tone}>{release.priority}</Badge>}
          {release.archived && <Badge tone="neutral">Archived</Badge>}
          {release.in_catalog && <Badge tone="success">In catalog</Badge>}
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-muted flex-wrap">
          <span>{release.release_type || '—'}{release.genre ? ` · ${release.genre}` : ''}</span>
          <span>·</span>
          <span>{formatDate(release.release_date)}</span>
          {cd && <><span>·</span><span className={`font-semibold ${cd.cls}`}>{cd.label}</span></>}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-right">
          <div className="text-ink font-bold text-xl tabular-nums leading-none">{pct}%</div>
          <div className="text-ink-muted text-xs mt-0.5">{done} of {total}</div>
        </div>
        {/* Progress ring. strokeDasharray on r=15.9 makes the circumference
            ≈100, so the array is literally "percent done / percent left". */}
        <svg className="w-10 h-10 flex-shrink-0" style={{ transform: 'rotate(-90deg)' }} viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" className="text-gray-100" strokeWidth="3.5" />
          <circle
            cx="18" cy="18" r="15.9" fill="none" strokeWidth="3.5" strokeLinecap="round"
            stroke="currentColor" className={pct === 100 ? 'text-success' : 'text-brand-600'}
            strokeDasharray={`${pct} ${100 - pct}`}
          />
        </svg>
      </div>
    </div>
  )
}

// ── Checklist ────────────────────────────────────────────────────────────
function ChecklistTab({ release, patch, onPatched }) {
  const [saving, setSaving] = useState(false)

  const toggle = async (key) => {
    if (saving) return // in-flight guard: two rapid clicks must not race
    setSaving(true)
    // flushSync forces the optimistic flip to land NOW, so `next` is computed
    // from the freshest state and the request body carries a real boolean even
    // under rapid toggling.
    let next
    flushSync(() => {
      next = !release[key]
      onPatched({ ...release, [key]: next })
    })
    const res = await patch({ [key]: next })
    // Roll the optimistic flip back if the write failed.
    if (!res) onPatched({ ...release, [key]: !next })
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      {RELEASE_CHECKLIST_GROUPS.map(group => {
        const gDone = group.keys.filter(k => release[k]).length
        return (
          <div key={group.name}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-bold text-ink-muted uppercase tracking-widest whitespace-nowrap">{group.name}</span>
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-ink-faint tabular-nums">{gDone}/{group.keys.length}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {group.keys.map(key => {
                const on = !!release[key]
                return (
                  <button
                    key={key}
                    onClick={() => toggle(key)}
                    disabled={saving}
                    aria-pressed={on}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-all border text-left disabled:opacity-60 ${
                      on ? 'bg-brand-600 border-brand-600 text-white shadow-sm' : 'bg-card border-rule text-ink-muted hover:bg-gray-50'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${on ? 'border-white/50' : 'border-gray-300'}`}>
                      {on && <Check size={10} strokeWidth={3} className="text-white" />}
                    </span>
                    {LABELS[key] || key}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Metadata & links ─────────────────────────────────────────────────────
const META_TEXT_FIELDS = [
  { key: 'upc', label: 'UPC / EAN', placeholder: 'UPC code' },
  { key: 'isrc', label: 'ISRC', placeholder: 'ISRC code' },
  { key: 'apple_id', label: 'Apple ID', placeholder: 'Apple ID' },
  { key: 'spotify_uri', label: 'Spotify URI', placeholder: 'spotify:album:…' },
  { key: 'presave_link', label: 'Pre-save link', placeholder: 'https://…' },
  { key: 'presave_analytics', label: 'Pre-save analytics', placeholder: 'https://…' },
  { key: 'ugc_link', label: 'UGC link', placeholder: 'https://…' },
  { key: 'apple_music_link', label: 'Apple Music link', placeholder: 'https://…' },
  { key: 'producer', label: 'Producer', placeholder: 'Producer name' },
  { key: 'featured_artists', label: 'Featured artists', placeholder: 'Comma-separated' },
  { key: 'subgenre', label: 'Subgenre', placeholder: 'e.g. Trap' },
]

// Stored links, rendered as links. Every one of these fields was previously
// text-input-only — a saved Spotify URI or pre-save URL was never clickable
// anywhere in the app.
const LINK_FIELDS = [
  { key: 'spotify_uri', label: 'Spotify', href: (r) => spotifyUrl(r.spotify_uri) },
  { key: 'apple_music_link', label: 'Apple Music', href: (r) => r.apple_music_link },
  { key: 'presave_link', label: 'Pre-save', href: (r) => r.presave_link },
  { key: 'presave_analytics', label: 'Pre-save analytics', href: (r) => r.presave_analytics },
  { key: 'ugc_link', label: 'UGC', href: (r) => r.ugc_link },
]

function MetadataTab({ release, patch, onDirtyChange }) {
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const val = (k) => (draft?.[k] ?? release[k] ?? '')
  const set = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.value }))

  // Surface unsaved edits to the page shell so Escape can't silently bin them.
  useEffect(() => { onDirtyChange?.(!!draft); return () => onDirtyChange?.(false) }, [!!draft]) // eslint-disable-line react-hooks/exhaustive-deps

  const links = LINK_FIELDS.map(f => ({ ...f, url: f.href(release) })).filter(f => f.url)

  const save = async () => {
    if (!draft) return
    setSaving(true)
    // '' clears the column rather than being ignored — an empty box means
    // "remove this", not "leave whatever was there".
    const body = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v === '' ? null : v]))
    const ok = await patch(body)
    setSaving(false)
    if (ok) setDraft(null)
  }

  return (
    <div className="space-y-5">
      {links.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {links.map(l => (
            <a
              key={l.key} href={l.url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-rule text-ink-muted hover:text-brand-ink hover:border-brand-400 transition-colors"
            >
              <ExternalLink size={12} /> {l.label}
            </a>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {META_TEXT_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="label">{label}</label>
            <input className="input" value={val(key)} onChange={set(key)} placeholder={placeholder} />
          </div>
        ))}
        <div>
          <label className="label">Cover art status</label>
          <select className="input" value={val('cover_art_status') || 'Pending'} onChange={set('cover_art_status')}>
            {COVER_ART_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Priority</label>
          <select className="input" value={val('priority') || 'Standard'} onChange={set('priority')}>
            <option value="Standard">Standard</option>
            {PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { key: 'distributor_notes', label: 'Distributor notes', placeholder: 'Notes for the distributor…' },
          { key: 'notes', label: 'Internal notes', placeholder: 'Additional notes…' },
        ].map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="label">{label}</label>
            <textarea rows={3} className="input resize-none" value={val(key)} onChange={set(key)} placeholder={placeholder} />
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button onClick={save} disabled={saving || !draft} className="btn-primary disabled:opacity-40">
          {saving ? 'Saving…' : 'Save metadata'}
        </button>
      </div>
    </div>
  )
}

// ── Activity ─────────────────────────────────────────────────────────────
function ActivityTab({ releaseId }) {
  const [rows, setRows] = useState(null)
  const [failed, setFailed] = useState(false)
  const load = useCallback(() => {
    setFailed(false)
    api.get(`/releases/${releaseId}/activity`)
      .then(r => setRows(r.data.data || []))
      .catch(() => { setRows([]); setFailed(true) })
  }, [releaseId])
  useEffect(() => { load() }, [load])

  if (rows === null) return <p className="py-8 text-center text-sm text-ink-muted">Loading activity…</p>
  if (failed) return (
    <div className="py-8 text-center">
      <p className="text-sm text-ink-muted mb-2">Couldn’t load this release’s history.</p>
      <button onClick={load} className="btn-secondary">Retry</button>
    </div>
  )
  if (!rows.length) return <p className="py-8 text-center text-sm text-ink-muted">No activity recorded yet.</p>

  return (
    <div className="divide-y divide-divider">
      {rows.map(a => (
        <div key={a.key || a.id} className="flex items-start gap-3 py-3">
          <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-xs font-bold text-ink-muted">{a.user_name?.charAt(0)?.toUpperCase() || '?'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-ink break-words">{a.detail || a.action}</p>
            <p className="text-xs text-ink-muted mt-0.5 flex items-center gap-1">
              <Clock size={10} />
              {a.user_name || 'Someone'} · {new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Details ──────────────────────────────────────────────────────────────
function DetailsTab({ release, patch, onPatched, onRemoved, artists, members, isAdmin, canAssign }) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [core, setCore] = useState({})
  const [savingCore, setSavingCore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null) // 'delete' | 'catalog'
  const listId = useRef(`artists-${release.id}`).current

  const startEdit = () => {
    setCore({
      artist_name: release.artist_name || '',
      project_name: release.project_name || '',
      release_date: release.release_date ? String(release.release_date).slice(0, 10) : '',
      release_type: release.release_type || '',
      genre: release.genre || '',
      priority: release.priority || 'Standard',
    })
    setEditing(true)
  }

  const saveCore = async () => {
    setSavingCore(true)
    // artist_name goes over as-is: the server finds-or-creates inside this
    // label, which is what makes reassigning a release's artist possible.
    const ok = await patch(core)
    setSavingCore(false)
    if (ok) setEditing(false)
  }

  const toggleArchive = async () => {
    setBusy(true)
    try {
      const { data } = await api.put(`/releases/${release.id}/archive`)
      onPatched(data.data)
    } catch { toast('Failed to archive', 'error') }
    finally { setBusy(false) }
  }

  const toggleCatalog = async () => {
    setBusy(true)
    try {
      const { data } = await api.put(`/releases/${release.id}/catalog`)
      onPatched(data.data)
      toast(data.data.in_catalog ? 'Moved to the catalog' : 'Moved back to the tracker')
    } catch { toast('Failed to update the catalog', 'error') }
    finally { setBusy(false); setConfirm(null) }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.delete(`/releases/${release.id}`)
      toast('Release deleted')
      onRemoved?.(release.id)
    } catch (err) { toast(err.response?.data?.error || 'Failed to delete', 'error') }
    finally { setBusy(false); setConfirm(null) }
  }

  return (
    <div className="space-y-6">
      {/* Assignment */}
      <div className="flex items-center gap-4 pb-5 border-b border-divider flex-wrap">
        <div className="flex items-center gap-2 text-xs font-bold text-ink-muted uppercase tracking-wider">
          <User size={13} /> Assigned to
          {release.assignee_name && <Link to="/team" className="normal-case tracking-normal text-brand-ink hover:underline">{release.assignee_name}</Link>}
        </div>
        <select
          className="input !w-auto"
          value={release.assigned_to || ''}
          disabled={!canAssign}
          onChange={e => patch({ assigned_to: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Unassigned</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <div className="flex items-center gap-2 text-xs font-bold text-ink-muted uppercase tracking-wider">Status</div>
        <select className="input !w-auto" value={release.status || 'Draft'} onChange={e => patch({ status: e.target.value })}>
          {RELEASE_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Core fields */}
      {!editing ? (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 mb-5">
            {[
              ['Artist', release.artist_name],
              ['Project', release.project_name],
              ['Release date', formatDate(release.release_date)],
              ['Format', release.release_type],
              ['Genre', release.genre],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-1">{label}</p>
                <p className="text-sm font-semibold text-ink break-words">{value || '—'}</p>
              </div>
            ))}
            <div>
              <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-1">Priority</p>
              {priorityToneOf(release)
                ? <Badge tone={priorityToneOf(release)}>{release.priority}</Badge>
                : <p className="text-sm text-ink-muted">Standard</p>}
            </div>
          </div>
          <button onClick={startEdit} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-brand-ink transition-colors">
            <Pencil size={12} /> Edit details
          </button>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-5">
            <div>
              <label className="label">Artist</label>
              <input className="input" list={listId} value={core.artist_name} onChange={e => setCore(c => ({ ...c, artist_name: e.target.value }))} />
              <datalist id={listId}>{artists.map(a => <option key={a.id} value={a.name} />)}</datalist>
            </div>
            <div><label className="label">Project</label><input className="input" value={core.project_name} onChange={e => setCore(c => ({ ...c, project_name: e.target.value }))} /></div>
            <div><label className="label">Release date</label><input type="date" className="input" value={core.release_date} onChange={e => setCore(c => ({ ...c, release_date: e.target.value }))} /></div>
            <div>
              <label className="label">Format</label>
              <select className="input" value={core.release_type} onChange={e => setCore(c => ({ ...c, release_type: e.target.value }))}>
                <option value="">—</option>{RELEASE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Genre</label>
              <input className="input" list="release-genres" value={core.genre} onChange={e => setCore(c => ({ ...c, genre: e.target.value }))} placeholder="e.g. Hip-Hop" />
              <datalist id="release-genres">{GENRE_OPTIONS.map(g => <option key={g} value={g} />)}</datalist>
            </div>
            <div>
              <label className="label">Priority</label>
              <select className="input" value={core.priority} onChange={e => setCore(c => ({ ...c, priority: e.target.value }))}>
                <option value="Standard">Standard</option>{PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={saveCore} disabled={savingCore} className="btn-primary"><Save size={13} /> {savingCore ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="pt-5 border-t border-divider">
        <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-3">Actions</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => (release.in_catalog ? setConfirm('catalog') : toggleCatalog())} disabled={busy} className="btn-secondary">
            <Library size={13} /> {release.in_catalog ? 'Move back to tracker' : 'Mark as released'}
          </button>
          <button onClick={toggleArchive} disabled={busy} className="btn-secondary" title="Use for delayed or never-released projects">
            {release.archived ? <><RotateCcw size={13} /> Unarchive</> : <><Archive size={13} /> Archive</>}
          </button>
          {isAdmin && (
            <button onClick={() => setConfirm('delete')} disabled={busy} className="btn-secondary text-danger">
              <Trash2 size={13} /> Delete permanently
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'delete'} busy={busy}
        onClose={() => setConfirm(null)} onConfirm={remove}
        title="Delete release"
        message={`Permanently delete “${release.project_name}”? This cannot be undone.`}
        confirmLabel="Delete release"
      />
      <ConfirmDialog
        open={confirm === 'catalog'} busy={busy}
        onClose={() => setConfirm(null)} onConfirm={toggleCatalog}
        title="Move back to tracker"
        message="Move this release out of the catalog and back into the active pipeline?"
        confirmLabel="Move back" variant="primary"
      />
    </div>
  )
}
