// Live per-label category vocabulary, with the hardcoded constants as the
// offline fallback — a picker must never render empty because a fetch
// failed, and the fallback must never VANISH options the server would offer.
//
// Module-level cache: one fetch per session (all pickers share it), refetched
// on window focus so an admin adding a category doesn't require a reload
// everywhere. The order the server returns is load-bearing (usage-first,
// groups.flatMap) — never re-sort client-side.

import { useEffect, useState } from 'react'
import api from '../api'
import { EXPENSE_CATEGORIES, INCOME_TYPES } from '../constants'

const FALLBACK = {
  expense: EXPENSE_CATEGORIES,
  income: INCOME_TYPES,
  expenseGroups: null,
  incomeGroups: null,
  meta: [],
  ready: false,
}

let cache = null
let inflight = null
const listeners = new Set()

async function fetchCategories() {
  if (inflight) return inflight
  inflight = api
    .get('/categories')
    .then((res) => {
      const d = res.data.data || {}
      cache = {
        expense: d.expense?.length ? d.expense : EXPENSE_CATEGORIES,
        income: d.income?.length ? d.income : INCOME_TYPES,
        expenseGroups: d.expense_groups || null,
        incomeGroups: d.income_groups || null,
        meta: d.meta || [],
        ready: true,
      }
      listeners.forEach((fn) => fn(cache))
      return cache
    })
    .catch(() => {
      cache = cache || { ...FALLBACK }
      return cache
    })
    .finally(() => { inflight = null })
  return inflight
}

// Exposed for logout / workspace switch — the next mount refetches.
export function resetCategoriesCache() {
  cache = null
}

export default function useCategories() {
  const [state, setState] = useState(cache || FALLBACK)

  useEffect(() => {
    const onData = (c) => setState(c)
    listeners.add(onData)
    if (cache) setState(cache)
    else fetchCategories()
    const onFocus = () => fetchCategories()
    window.addEventListener('focus', onFocus)
    return () => {
      listeners.delete(onData)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return state
}
