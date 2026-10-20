import type { CSSProperties } from 'react'

// Shared by the filename-rules settings sections and their dialog.

export const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-deep)',
  color: 'var(--text)',
  fontSize: 13,
}

export const monoInputStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
}

export function buttonStyle(primary = false, disabled = false): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 6,
    fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    border: primary ? '1px solid var(--gold-dim)' : '1px solid var(--border)',
    background: primary ? 'var(--gold-dim)' : 'var(--bg-card)',
    color: primary ? 'var(--bg-deep)' : 'var(--text-dim)',
    fontWeight: primary ? 600 : 400,
  }
}

export const iconButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'inline-flex',
  padding: 4,
  borderRadius: 4,
}

export const hintStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  lineHeight: 1.5,
}

export const badgeStyle = (tone: 'muted' | 'warn' | 'danger'): CSSProperties => ({
  display: 'inline-block',
  fontSize: 11,
  padding: '1px 7px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  color:
    tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--gold)' : 'var(--text-muted)',
  whiteSpace: 'nowrap',
})

// A failed request's message: the server's `detail` when it sent one.
export const failure = (err: unknown): string => {
  const e = err as { body?: { detail?: unknown }; message?: string } | null | undefined
  const detail = e?.body?.detail
  return (typeof detail === 'string' && detail) || e?.message || ''
}
