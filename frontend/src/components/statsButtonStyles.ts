import type { CSSProperties } from 'react'

/** The save button the stats pickers share, styled like the settings forms'. */
export const primaryButton = (busy: boolean): CSSProperties => ({
  padding: '8px 18px',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  background: 'var(--gold-dim)',
  border: 'none',
  color: 'var(--bg-deep)',
  cursor: busy ? 'default' : 'pointer',
  opacity: busy ? 0.6 : 1,
})

export const secondaryButton = (busy: boolean): CSSProperties => ({
  padding: '8px 14px',
  borderRadius: 6,
  fontSize: 14,
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  cursor: busy ? 'default' : 'pointer',
  opacity: busy ? 0.6 : 1,
})
