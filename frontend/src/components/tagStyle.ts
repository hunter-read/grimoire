import type { CSSProperties } from 'react'

/** Shared visual style + label casing for tag chips (Tag / LinkableTag). */
export function tagStyle(color?: string | null): CSSProperties {
  return {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 20,
    background: color || 'var(--tag-bg)',
    border: '1px solid var(--tag-border)',
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-dim)',
    marginRight: 6,
    marginBottom: 4,
  }
}

export const displayLabel = <T extends string | null | undefined>(label: T): T | string =>
  label ? label.charAt(0).toUpperCase() + label.slice(1) : label
