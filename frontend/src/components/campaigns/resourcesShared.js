import { LuBookOpen, LuMap, LuUser, LuFile } from 'react-icons/lu'

export const TYPE_ICONS = {
  book: { Icon: LuBookOpen, color: '#a78bfa' },
  map: { Icon: LuMap, color: '#60a5fa' },
  token: { Icon: LuUser, color: '#34d399' },
  file: { Icon: LuFile, color: '#e0b341' },
}

export const RESOURCE_NAV = {
  book: (id) => `/library/book/${id}`,
  map: (id) => `/maps/${id}`,
  token: (id) => `/tokens/${id}`,
}

// Visibility selector order: public, then private, then GM-only.
export const VISIBILITY_OPTIONS = ['public', 'private', 'gm']

export const selectStyle = {
  appearance: 'auto',
  fontSize: 12,
  padding: '3px 6px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-dim)',
  cursor: 'pointer',
}
