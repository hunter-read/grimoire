import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FileManagerSection from './FileManagerSection'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

describe('FileManagerSection', () => {
  it('describes the feature', () => {
    render(<FileManagerSection />)
    expect(screen.getByText('files.title')).toBeInTheDocument()
    expect(screen.getByText('files.sectionDescription')).toBeInTheDocument()
  })

  it('links to the full-page manager', () => {
    render(<FileManagerSection />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/settings/files')
  })

  it('highlights on hover and restores on leave', () => {
    render(<FileManagerSection />)
    const link = screen.getByRole('link')

    fireEvent.mouseEnter(link)
    expect(link.style.background).toBe('var(--bg-card-hover)')

    fireEvent.mouseLeave(link)
    expect(link.style.background).toBe('var(--bg-card)')
  })
})
