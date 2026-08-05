// The ONE keyboard-shortcuts registry. Both the "?" help modal and the in-app
// manual read from this so the documented shortcuts never drift from reality.
// When you wire a new hotkey with useHotkeys, add it here in the same commit.
export const SHORTCUT_GROUPS = [
  {
    group: 'Global',
    items: [
      { keys: ['⌘', 'K'], desc: 'Open search' },
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
    group: 'Ledger',
    items: [
      { keys: ['Z'], desc: 'Undo last inline edit' },
    ],
  },
  {
    group: 'Deal pipeline',
    items: [
      { keys: ['N'], desc: 'New deal' },
    ],
  },
  {
    group: 'Release detail',
    items: [
      { keys: ['1', '–', '7'], desc: 'Switch tabs' },
    ],
  },
]

// Flat list (handy for search / the manual).
export const ALL_SHORTCUTS = SHORTCUT_GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.group })))
