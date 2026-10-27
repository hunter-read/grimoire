import type { CSSProperties } from 'react'

/**
 * Shared styles for the export panel (issue #207). The values are the reader's
 * own - the toolbar's bordered groups, the sidebars' 13px labels, the move
 * dialog's buttons - so the panel reads as part of the reader, not a new tool.
 */

export const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }

export const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-dim)',
  letterSpacing: '0.02em',
}

export const hintStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  lineHeight: 1.5,
  margin: 0,
}

export const warnStyle: CSSProperties = { ...hintStyle, color: 'var(--warning)' }

export const errorStyle: CSSProperties = { ...hintStyle, color: 'var(--danger)' }

export const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 10px',
  fontSize: 14,
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
}

export function buttonStyle(primary: boolean, disabled = false): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: primary ? 600 : 400,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: `1px solid ${primary ? 'var(--gold)' : 'var(--border)'}`,
    background: primary ? 'var(--gold)' : 'var(--bg-card)',
    color: primary ? 'var(--on-accent)' : 'var(--text)',
    opacity: disabled ? 0.5 : 1,
    whiteSpace: 'nowrap',
  }
}

/** A small pill for one-tap choices, such as "This page" or "This spread". */
export function chipStyle(active: boolean): CSSProperties {
  return {
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 12,
    cursor: 'pointer',
    border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
    background: active ? 'var(--bg-card-hover)' : 'var(--bg-card)',
    color: active ? 'var(--gold)' : 'var(--text-dim)',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }
}

/** The numbered badge shared by a cut-out on the page and its row in the list. */
export function numberStyle(active: boolean): CSSProperties {
  return {
    flexShrink: 0,
    minWidth: 20,
    height: 20,
    padding: '0 5px',
    boxSizing: 'border-box',
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    background: active ? 'var(--gold)' : 'var(--bg-card)',
    color: active ? 'var(--on-accent)' : 'var(--text-dim)',
    border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
  }
}
