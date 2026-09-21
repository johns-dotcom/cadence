import { useEffect, useState } from 'react'
import api from '../../api'
import { PREF_KEY, PREF_DEFAULTS, PREF_LABELS, PREF_HELP } from '../../lib/notificationPrefs'

// Per-ACCOUNT notification preferences, server-backed. Shared by the tenant and
// console Settings shells so both edit the same thing the bell reads. These
// used to be per-DEVICE (localStorage), so a toggle on a laptop did nothing on
// a phone; the card says so, because a preference that silently applied to only
// one browser is worse than none.
export default function NotificationPrefsPanel() {
  const [prefs, setPrefs] = useState(() => {
    try { return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } }
    catch { return { ...PREF_DEFAULTS } }
  })

  useEffect(() => {
    api.get('/settings/me')
      .then(r => {
        const server = r.data?.data?.notification_prefs
        if (server && typeof server === 'object') setPrefs({ ...PREF_DEFAULTS, ...server })
      })
      .catch(() => { /* keep the localStorage cache */ })
  }, [])

  const toggle = (k) => {
    const v = prefs[k] === false // currently off → turning on
    const next = { ...prefs, [k]: v }
    setPrefs(next)
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    api.put('/settings/me/notifications', { [k]: v }).catch(() => { /* cache holds it */ })
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-bold text-ink mb-1">Notifications</h2>
      <p className="text-xs text-ink-muted mb-4">
        Which alerts appear in your bell. Saved to your account, so they follow you across devices.
      </p>
      <div className="divide-y divide-divider">
        {Object.keys(PREF_DEFAULTS).map(k => {
          const on = prefs[k] !== false
          return (
            <label key={k} className="flex items-start justify-between gap-4 py-2.5 cursor-pointer">
              <span className="min-w-0">
                <span className="block text-sm text-ink">{PREF_LABELS[k]}</span>
                {PREF_HELP[k] && <span className="block text-[11px] text-ink-faint mt-0.5">{PREF_HELP[k]}</span>}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={PREF_LABELS[k]}
                onClick={() => toggle(k)}
                className={`mt-0.5 w-9 h-5 rounded-full flex-shrink-0 transition relative
                  ${on ? 'bg-brand-600' : 'bg-elev border border-rule'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-all
                  ${on ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </label>
          )
        })}
      </div>
    </div>
  )
}
