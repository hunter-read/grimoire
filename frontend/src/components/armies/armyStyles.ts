import type { CSSProperties } from 'react'

/** Shared styles for the army and league pages, built on the theme's variables. */

export const page: CSSProperties = { padding: 24, maxWidth: 1200, margin: '0 auto' }

export const header: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  marginBottom: 24,
}

export const title: CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  margin: 0,
}

export const card: CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 16,
}

export const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: 14,
}

export const primaryBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--gold-dim)',
  background: 'var(--gold)',
  color: 'var(--on-accent)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

export const secondaryBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  fontSize: 13,
  cursor: 'pointer',
}

export const iconBtn: CSSProperties = { ...secondaryBtn, padding: '4px 8px' }

export const dangerBtn: CSSProperties = {
  ...secondaryBtn,
  color: 'var(--danger)',
  borderColor: 'var(--danger)',
}

export const input: CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 14,
}

export const label: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: 'var(--text-muted)',
}

export const muted: CSSProperties = { fontSize: 13, color: 'var(--text-muted)' }

export const errorText: CSSProperties = { color: 'var(--danger)', fontSize: 13 }

export const chip: CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  background: 'var(--tag-bg)',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
}

export const sectionTitle: CSSProperties = { fontSize: 15, margin: '0 0 10px' }

export const row: CSSProperties = {
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
  alignItems: 'flex-end',
}
