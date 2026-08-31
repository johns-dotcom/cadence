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
    group: 'Bank review deck',
    items: [
      { keys: ['→'], desc: 'Accept (match or book the card)' },
      { keys: ['←'], desc: 'Skip' },
      { keys: ['D'], desc: 'Dismiss (not a ledger item)' },
      { keys: ['1', '–', '9'], desc: 'Pick a category / income type' },
      { keys: ['Esc'], desc: 'Close the deck' },
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
