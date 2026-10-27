import { LuPanelRight, LuPanelLeft, LuPanelTop, LuPanelBottom } from 'react-icons/lu'

// Where a pinned second pane sits relative to the first. Side-by-side splits
// read as two columns; top/bottom stack them.
export const SPLIT_ICONS = {
  right: LuPanelRight,
  left: LuPanelLeft,
  top: LuPanelTop,
  bottom: LuPanelBottom,
}

// Every container kind the UI can set, in menu order. '' clears the kind.
export const CONTAINER_KINDS = [
  '',
  'parent',
  'one-page',
  'agnostic',
  'family',
  'publisher',
  'generic',
]

// The browse API names collections by their library folder (plural), while the
// metadata editor and the bulk API key everything by singular resource type.
// Mapping here rather than assuming they match: they do not, and treating
// "books" as a type gave the editor an unknown key, which it dereferenced and
// crashed on — a blank page instead of a form.
export const EDITOR_TYPES = {
  books: 'book',
  maps: 'map',
  tokens: 'token',
  audio: 'audio',
  models: 'model',
  // Folders that resolve to a GameSystem report this directly.
  system: 'system',
}

// Kinds that name *the* collection of their sort. The backend enforces this too;
// hiding them here means the user is never offered a choice that would be
// refused.
export const SINGLETON_KINDS = new Set(['one-page', 'agnostic'])

export const ghostBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-dim)',
}

export const menuItem = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 10px',
  borderRadius: 5,
  border: 'none',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left',
}

// Hover feedback for context-menu rows. Applied as handlers rather than CSS
// because the menu is inline-styled like the rest of this view.
export const menuHover = {
  onMouseEnter: (e) => {
    e.currentTarget.style.background = 'var(--bg-card-hover)'
  },
  onMouseLeave: (e) => {
    e.currentTarget.style.background = 'transparent'
  },
}
