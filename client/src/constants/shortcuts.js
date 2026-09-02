// The ONE keyboard-shortcuts registry. Both the "?" help modal and the in-app
// manual read from this, so what is documented and what is wired cannot drift.
// When you wire a new hotkey with useHotkeys, add it here in the same commit.
//
// This list has been reconciled against every live handler in the app
// (useHotkeys consumers plus the four pages that register raw keydown listeners
// because they need modifier chords or a capture-phase deck). A registry that
// omits a working key is as bad as one that promises a key that does nothing —
// both teach people to stop trusting it.
export const SHORTCUT_GROUPS = [
  {
    group: 'Global',
    items: [
      { keys: ['⌘', 'K'], desc: 'Open search' },
      { keys: ['/'], desc: 'Open search' },
      { keys: ['?'], desc: 'Show this help' },
      { keys: ['Esc'], desc: 'Close dialogs' },
      { keys: ['G', 'D'], desc: 'Go to Dashboard' },
      { keys: ['G', 'R'], desc: 'Go to Releases' },
      { keys: ['G', 'A'], desc: 'Go to Artists' },
      { keys: ['G', 'C'], desc: 'Go to Calendar' },
      { keys: ['G', 'W'], desc: 'Go to My Work' },
    ],
  },
  {
    group: 'Search palette',
    items: [
      { keys: ['↑', '↓'], desc: 'Move between results' },
      { keys: ['↵'], desc: 'Open the highlighted result' },
      { keys: ['Esc'], desc: 'Close the palette' },
    ],
  },
  {
    group: 'My Work / Team Work',
    items: [
      { keys: ['N'], desc: 'New task' },
      { keys: ['1'], desc: 'Board view' },
      { keys: ['2'], desc: 'Table view' },
      { keys: ['3'], desc: 'Calendar view' },
      { keys: ['4'], desc: 'List view' },
      { keys: ['5'], desc: 'Workload view (Team Work)' },
      { keys: ['G'], desc: 'Cycle group-by' },
      { keys: ['F'], desc: 'Focus search' },
      { keys: ['Z'], desc: 'Undo last inline edit' },
      { keys: ['Esc'], desc: 'Close drawer · clear selection' },
    ],
  },
  {
    group: 'Ledger',
    items: [
      { keys: ['Z'], desc: 'Undo last inline edit' },
      { keys: ['C'], desc: 'Toggle the columns panel' },
      { keys: ['X'], desc: 'Toggle the export menu' },
    ],
  },
  {
    group: 'Approvals',
    items: [
      { keys: ['J'], desc: 'Focus the next invoice' },
      { keys: ['K'], desc: 'Focus the previous invoice' },
      { keys: ['A'], desc: 'Review / approve the focused invoice' },
      { keys: ['R'], desc: 'Reject the focused invoice' },
      { keys: ['⇧', 'A'], desc: 'Review all (or the selection)' },
    ],
  },
  {
    group: 'Releases list',
    items: [
      { keys: ['N'], desc: 'Add a release' },
      { keys: ['V'], desc: 'Toggle list / calendar' },
      { keys: ['J'], desc: 'Focus the next row' },
      { keys: ['K'], desc: 'Focus the previous row' },
      { keys: ['↵'], desc: 'Expand / collapse the focused row' },
      { keys: ['1', '–', '7'], desc: 'Switch tabs in the expanded row' },
    ],
  },
  {
    group: 'Release detail',
    items: [
      { keys: ['1', '–', '7'], desc: 'Switch tabs' },
    ],
  },
  {
    group: 'Calendar',
    items: [
      { keys: ['←'], desc: 'Previous month' },
      { keys: ['→'], desc: 'Next month' },
      { keys: ['T'], desc: 'Jump to today' },
      { keys: ['N'], desc: 'New event' },
      { keys: ['Esc'], desc: 'Clear the selected day' },
    ],
  },
  {
    group: 'Catalog',
    items: [
      { keys: ['S'], desc: 'Sync artwork' },
      { keys: ['1', '–', '6'], desc: 'Pick a time range' },
    ],
  },
  {
    group: 'Deal pipeline',
    items: [
      { keys: ['N'], desc: 'New deal' },
      { keys: ['Esc'], desc: 'Close the card drawer' },
    ],
  },
  {
    group: 'Create Invoice',
    items: [
      { keys: ['⌘', '↵'], desc: 'Save the invoice' },
      { keys: ['⌘', '⇧', 'L'], desc: 'Add a line item' },
      { keys: ['⌘', 'P'], desc: 'Download the open (or latest) invoice' },
    ],
  },
  {
    group: 'Bank review deck',
    items: [
      { keys: ['→'], desc: 'Accept (match or book the card)' },
      { keys: ['←'], desc: 'Skip' },
      { keys: ['⌫'], desc: 'Step back to the previous card' },
      { keys: ['D'], desc: 'Dismiss (not a ledger item)' },
      { keys: ['F'], desc: 'Flag for review' },
      { keys: ['N'], desc: 'Book with no invoice' },
      { keys: ['B'], desc: 'Force book instead of match' },
      { keys: ['S'], desc: 'Search for an invoice to attach' },
      { keys: ['1', '–', '9'], desc: 'Pick a category / income type' },
      { keys: ['Esc'], desc: 'Close the deck' },
    ],
  },
  {
    group: 'Other pages',
    items: [
      { keys: ['N'], desc: 'New contract (Contracts)' },
      { keys: ['R'], desc: 'Refresh the dashboard (Dashboard)' },
      { keys: ['S'], desc: 'Flip the sort order (Activity)' },
    ],
  },
]

// Flat list (handy for search / the manual).
export const ALL_SHORTCUTS = SHORTCUT_GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.group })))
