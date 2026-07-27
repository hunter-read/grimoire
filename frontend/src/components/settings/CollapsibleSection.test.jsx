import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CollapsibleSection from './CollapsibleSection'

describe('CollapsibleSection', () => {
  beforeEach(() => localStorage.clear())

  it('renders open by default with title, description, and children', () => {
    render(
      <CollapsibleSection title="Genres" description="Manage genres">
        <div>body</div>
      </CollapsibleSection>
    )
    expect(screen.getByText('Genres')).toBeInTheDocument()
    expect(screen.getByText('Manage genres')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /genres/i })).toHaveAttribute('aria-expanded', 'true')
  })

  it('toggles the body when the header is clicked', async () => {
    render(
      <CollapsibleSection title="Genres">
        <div>body</div>
      </CollapsibleSection>
    )
    await userEvent.click(screen.getByRole('button', { name: /genres/i }))
    expect(screen.queryByText('body')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /genres/i }))
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('remembers collapsed state via storageKey', async () => {
    const { unmount } = render(
      <CollapsibleSection title="Genres" storageKey="k1">
        <div>body</div>
      </CollapsibleSection>
    )
    await userEvent.click(screen.getByRole('button', { name: /genres/i }))
    expect(localStorage.getItem('k1')).toBe('0')
    unmount()

    render(
      <CollapsibleSection title="Genres" storageKey="k1">
        <div>body</div>
      </CollapsibleSection>
    )
    // Persisted collapsed → body hidden on remount.
    expect(screen.queryByText('body')).not.toBeInTheDocument()
  })

  it('honors defaultOpen=false when no stored state', () => {
    render(
      <CollapsibleSection title="Genres" defaultOpen={false}>
        <div>body</div>
      </CollapsibleSection>
    )
    expect(screen.queryByText('body')).not.toBeInTheDocument()
  })
})
