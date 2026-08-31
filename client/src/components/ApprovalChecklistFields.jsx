import { Check } from 'lucide-react'
import { CONFIRMATIONS, ANSWERS } from '../lib/approvalChecklist'
import useCategories from '../hooks/useCategories'
import CategoryOptions from './CategoryOptions'

// The checklist's questions. Presentation only — it decides nothing.
// Ported from boom-dashboard's ApprovalChecklistFields.
//
// Shared by the Approvals review deck and Add Invoice's pre-save review: an
// approver's add is written `status = 'approved'` on the spot, so it never
// reaches the Approvals queue — two surfaces, one set of questions, one
// implication rule (lib/approvalChecklist.js), because the alternative is two
// copies that drift, and this one decides whether an invoice may be filed.
//
// ── Two kinds of question, deliberately not styled alike ────────────────────
// The four CONFIRMATIONS are ticks: only "yes, that's right" is an answer.
// The four ANSWERS are Yes/No pairs, because "no" is a real answer there and it
// gets WRITTEN. Every one of those columns has a default, so without an explicit
// answer "somebody decided no" and "nobody ever looked" are the same row.
//
// Props:
//   values      what the row WILL hold — {artist, song, amount, category}. Not
//               the stored values: the card must show what is being confirmed.
//   checks      the answers so far
//   onCheck     (key, value) — undefined un-ticks
//   onCobrand   (value) — separate because answering it re-arms the category
//   onFieldChange (field, value) — the parent decides whether that means a PATCH
//               (the deck) or a form edit (Add Invoice)
//   context     the row's own is_bulk_deal / cobrand / recoupable, shown as
//               CONTEXT only and never as a pre-selected answer
export default function ApprovalChecklistFields({
  values = {},
  checks = {},
  onCheck,
  onCobrand,
  onFieldChange,
  context = {},
  disabled = false,
  fieldKey = '',
}) {
  // The flat vocabulary, for the render-a-stored-off-list-value rule below.
  const { expense: flatCategories } = useCategories()
  const c = checks

  const row = (label, node) => (
    <div className="flex items-start gap-2 py-1.5">
      <div className="w-[104px] flex-shrink-0 text-[11px] font-bold text-ink-faint uppercase tracking-wider pt-1.5">{label}</div>
      <div className="flex-1 min-w-0">{node}</div>
    </div>
  )

  return (
    <div className="space-y-0.5">
      {CONFIRMATIONS.map((item) => {
        const value = values[item.field]
        const ticked = c[item.key] === true
        return (
          <div key={item.key} className="border-b border-divider last:border-b-0 py-1">
            {row(item.label, (
              <div className="flex items-center gap-2">
                {item.field === 'category' ? (
                  <select
                    value={value || ''}
                    // Locked while cobrand is yes: the category is a consequence
                    // at that point, not a choice.
                    disabled={disabled || c.cobrand === true}
                    onChange={(e) => onFieldChange?.('category', e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1 text-[13px] border border-rule rounded-md bg-card text-ink disabled:opacity-60"
                  >
                    <option value="">(none)</option>
                    <CategoryOptions grouped />
                    {/* A stored value the vocabulary no longer offers still has
                        to render, or the select goes BLANK and invites a silent
                        recategorization. */}
                    {value && !flatCategories.includes(value)
                      && <option value={value}>{value}</option>}
                  </select>
                ) : (
                  <input
                    // Keyed on the value so an edit made elsewhere (or a new
                    // card) re-seeds this uncontrolled input.
                    key={`${fieldKey}:${item.field}:${value ?? ''}`}
                    defaultValue={value ?? ''}
                    disabled={disabled}
                    type={item.field === 'amount' ? 'number' : 'text'}
                    step={item.field === 'amount' ? '0.01' : undefined}
                    placeholder={item.field === 'song' ? '(no song)' : '(empty)'}
                    onBlur={(e) => {
                      const v = e.target.value
                      const cur = value ?? ''
                      if (String(v) !== String(cur)) onFieldChange?.(item.field, v)
                    }}
                    className="flex-1 min-w-0 px-2 py-1 text-[13px] border border-rule rounded-md bg-card text-ink"
                  />
                )}
                <button
                  type="button"
                  onClick={() => onCheck?.(item.key, ticked ? undefined : true)}
                  title={ticked ? 'Confirmed — click to un-confirm' : 'Confirm this is right'}
                  className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center border-2 transition-colors ${
                    ticked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-rule text-transparent hover:border-emerald-400'
                  }`}
                >
                  <Check size={15} strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        )
      })}

      {ANSWERS.map((q) => (
        <div key={q.key} className="border-b border-divider last:border-b-0 py-1">
          {row(q.label, (
            <div className="flex items-center gap-1.5">
              {[['Yes', true], ['No', false]].map(([text, val]) => {
                const on = c[q.key] === val
                return (
                  <button
                    key={text}
                    type="button"
                    onClick={() => (q.key === 'cobrand' ? onCobrand?.(val) : onCheck?.(q.key, val))}
                    // Campaign is locked once cobrand is yes — it is not a
                    // question at that point, it is a consequence.
                    disabled={disabled || (q.key === 'campaign' && c.cobrand === true)}
                    className={`px-3 py-1 rounded-md text-[12px] font-bold border-2 transition-colors disabled:opacity-60 ${
                      on
                        ? (val ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-gray-600 border-gray-600 text-white')
                        : 'border-rule text-ink-muted hover:border-gray-400'
                    }`}
                  >
                    {text}
                  </button>
                )
              })}
              <span className="text-[10px] text-ink-faint ml-1 truncate">{q.hint}</span>
            </div>
          ))}
          {/* What the SUBMITTER said, shown only when they said yes.
              `is_bulk_deal` is BOOLEAN DEFAULT FALSE, so false carries no
              information — it is equally "they said no" and "nobody was ever
              asked". True is the only value that means something, and it is
              context, never a pre-selected answer: the whole reason these are
              buttons is that this checklist records that a PERSON decided. */}
          {q.key === 'bulk_deal' && context.is_bulk_deal === true && (
            <p className="pl-[112px] pb-1 text-[10px] text-brand-ink">
              Marked bulk on the form
              {context.bulk_deal_quantity
                ? ` — ${context.bulk_deal_quantity} ${context.bulk_deal_unit || 'items'}`
                : ''}. Your answer is what gets recorded.
            </p>
          )}
          {q.key === 'cobrand' && context.cobrand === true && (
            <p className="pl-[112px] pb-1 text-[10px] text-brand-ink">
              Ticked cobrand on the form. Your answer is what gets recorded.
            </p>
          )}
          {/* The mirror image for recoupable — which value is the informative
              one is REVERSED here: the column defaults to TRUE, so FALSE is the
              only value that took an act. */}
          {q.key === 'recoupable' && context.recoupable === false && (
            <p className="pl-[112px] pb-1 text-[10px] text-warning">
              Currently marked NOT recoupable. Someone set that deliberately —
              the column defaults to yes.
            </p>
          )}
        </div>
      ))}

      {c.cobrand === true && values.category === 'Marketing' && (
        <p className="pt-2 text-[11px] text-brand-ink">
          Cobrand is marketing spend, so the category will be saved as <b>Marketing</b>. Confirm the category again.
        </p>
      )}
    </div>
  )
}
