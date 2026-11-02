import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LevelBadge from './LevelBadge'

describe('LevelBadge', () => {
  it('renders a coloured, labelled badge for a known level', () => {
    render(<LevelBadge level="ERROR" />)
    const el = screen.getByText('ERROR')
    // The visible level is the accessible text; no English-only aria-label.
    expect(el).not.toHaveAttribute('aria-label')
    expect(el.style.color).toBeTruthy()
  })

  it('renders the raw level for an unknown level', () => {
    render(<LevelBadge level="TRACE" />)
    expect(screen.getByText('TRACE')).toBeInTheDocument()
  })

  it('uses a lighter weight for DEBUG', () => {
    render(<LevelBadge level="DEBUG" />)
    expect(screen.getByText('DEBUG').style.fontWeight).toBe('400')
  })
})
