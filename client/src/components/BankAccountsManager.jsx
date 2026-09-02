import { useEffect, useState } from 'react'
import { Landmark, Plus, X } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'

// Admin editor for `labels.bank_accounts`.
//
// Why this panel has to exist: the account list is not cosmetic. Each row's
// `key` is what `bank_statements.account` stores, and `lib/bankEvidence.js`
// turns the `methods` list into per-account payment-method compatibility SQL —
// the rule that decides whether a bank line is even allowed to settle a given
// invoice. Until now the list was seeded from a hardcoded default (BofA +
// PayPal) with no way to change it, so a workspace banking anywhere else was
// silently matching against somebody else's assumptions.
//
// `methods` empty = "any payment method is compatible". That is a REAL setting,
// not a blank field, so it's stated on screen rather than implied.
const COMMON_METHODS = ['ACH', 'Wire', 'Check', 'PayPal', 'Card', 'Zelle', 'Cash', 'Crypto']

const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)

export default function BankAccountsManager() {
  const { toast } = useToast()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = () => api.get('/bank-statements/accounts')
    .then(r => setAccounts((r.data.data || []).map(a => ({ ...a, methods: Array.isArray(a.methods) ? a.methods : [] }))))
    .catch(() => {})
    .finally(() => setLoading(false))
  // Wrapped, not passed directly — a Promise returned from useEffect is read as
  // a cleanup function and crashes on unmount.
  useEffect(() => { load() }, [])

  const setField = (i, field) => (e) => setAccounts(list => list.map((a, idx) => idx === i ? { ...a, [field]: e.target.value } : a))
  const toggleMethod = (i, m) => setAccounts(list => list.map((a, idx) => {
    if (idx !== i) return a
    const has = a.methods.includes(m)
    return { ...a, methods: has ? a.methods.filter(x => x !== m) : [...a.methods, m] }
  }))
  const add = () => setAccounts(list => [...list, { key: '', label: '', methods: [] }])
  const remove = (i) => setAccounts(list => list.filter((_, idx) => idx !== i))

  const save = async () => {
    const cleaned = accounts
      .map(a => ({ key: slug(a.key || a.label), label: String(a.label || '').trim(), methods: a.methods }))
      .filter(a => a.key && a.label)
    if (!cleaned.length) { toast('Add at least one account', 'error'); return }
    const keys = cleaned.map(a => a.key)
    const dup = keys.find((k, i) => keys.indexOf(k) !== i)
    if (dup) { toast(`Two accounts share the key “${dup}” — keys must be unique`, 'error'); return }
    setSaving(true)
    try {
      const { data } = await api.put('/bank-statements/accounts', { accounts: cleaned })
      setAccounts((data.data || []).map(a => ({ ...a, methods: Array.isArray(a.methods) ? a.methods : [] })))
      toast('Bank accounts saved')
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><Landmark size={15} /> Bank accounts</h2>
      <p className="text-xs text-ink-muted mb-4">
        The accounts you upload statements for. Each one's <strong>key</strong> is what statements are filed under and
        what reconciliation joins on, so it can't be changed once statements exist — rename the display name instead.
        The payment methods you tick are the ones a line on that statement is allowed to settle; tick none to allow any.
      </p>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="space-y-3">
          {accounts.map((a, i) => (
            <div key={i} className="rounded-xl border border-rule p-3">
              <div className="flex flex-wrap items-end gap-2 mb-2">
                <div className="flex-1 min-w-[10rem]">
                  <label className="label" htmlFor={`acct-label-${i}`}>Display name</label>
                  <input id={`acct-label-${i}`} className="input !py-2" value={a.label} onChange={setField(i, 'label')} placeholder="Bank of America" />
                </div>
                <div className="w-36">
                  <label className="label" htmlFor={`acct-key-${i}`}>Key</label>
                  <input
                    id={`acct-key-${i}`}
                    className="input !py-2 font-mono"
                    value={a.key}
                    onChange={e => setAccounts(list => list.map((x, idx) => idx === i ? { ...x, key: slug(e.target.value) } : x))}
                    placeholder={slug(a.label) || 'bofa'}
                  />
                </div>
                <button type="button" onClick={() => remove(i)} aria-label={`Remove ${a.label || 'account'}`} className="text-ink-faint hover:text-danger p-2">
                  <X size={16} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mr-1">Methods</span>
                {COMMON_METHODS.map(m => {
                  const on = a.methods.includes(m)
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMethod(i, m)}
                      aria-pressed={on}
                      className={`text-[11px] font-semibold px-2 py-1 rounded-full border transition ${
                        on ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-ink-muted border-rule hover:border-gray-300'
                      }`}
                    >
                      {m}
                    </button>
                  )
                })}
                {a.methods.length === 0 && <span className="text-[11px] text-ink-faint ml-1">any method</span>}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={add} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:text-brand-700">
              <Plus size={13} /> Add account
            </button>
            <button type="button" onClick={save} disabled={saving} className="btn-primary ml-auto">{saving ? 'Saving…' : 'Save accounts'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
