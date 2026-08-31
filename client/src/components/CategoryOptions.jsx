// <option> list for a category <select>, fed by the live per-label
// vocabulary (hooks/useCategories) with the constants as offline fallback.
// Replaces the dozen inline `EXPENSE_CATEGORIES.map(...)` sites so every
// picker moved to data-driven categories in one shape.
//
// Renders grouped <optgroup>s when the server supplied groups (kind order is
// load-bearing — the review deck's 1-9 hotkeys index the FLAT order, which is
// groups.flatMap(items), exactly what this renders).

import useCategories from '../hooks/useCategories'

export default function CategoryOptions({ kind = 'expense', grouped = false }) {
  const cats = useCategories()
  const list = kind === 'income' ? cats.income : cats.expense
  const groups = kind === 'income' ? cats.incomeGroups : cats.expenseGroups

  if (grouped && groups?.length) {
    return groups.map((g) => (
      <optgroup key={g.key} label={g.label}>
        {g.items.map((c) => <option key={c} value={c}>{c}</option>)}
      </optgroup>
    ))
  }
  return list.map((c) => <option key={c} value={c}>{c}</option>)
}
