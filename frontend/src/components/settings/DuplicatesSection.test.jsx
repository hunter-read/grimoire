import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DuplicatesSection from './DuplicatesSection'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

describe('DuplicatesSection', () => {
  it('describes the feature', () => {
    render(<DuplicatesSection />)
    expect(screen.getByText('maintenance.dupes.title')).toBeInTheDocument()
    expect(screen.getByText('maintenance.dupes.description')).toBeInTheDocument()
  })

  it('links to the full page', () => {
    render(<DuplicatesSection />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/settings/duplicates')
  })

  it('highlights on hover and restores on leave', () => {
    render(<DuplicatesSection />)
    const link = screen.getByRole('link')

    fireEvent.mouseEnter(link)
    expect(link.style.background).toBe('var(--bg-card-hover)')

    fireEvent.mouseLeave(link)
    expect(link.style.background).toBe('var(--bg-card)')
  })
})
