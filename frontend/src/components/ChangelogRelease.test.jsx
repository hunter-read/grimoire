import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChangelogRelease from './ChangelogRelease'

const release = {
  version: '1.2.0',
  date: '2026-04-15',
  summary: 'A short description.',
  sections: [
    { title: 'Added', entries: ['First feature', 'Second feature'] },
    { title: 'Fixed', entries: ['A bug'] },
  ],
}

function renderRelease(props = {}) {
  return render(
    <ChangelogRelease
      release={release}
      isCurrent={false}
      isOpen={false}
      onToggle={vi.fn()}
      {...props}
    />
  )
}

describe('ChangelogRelease', () => {
  it('shows the version and date when collapsed', () => {
    renderRelease()
    expect(screen.getByText('1.2.0')).toBeInTheDocument()
    expect(screen.getByText('2026-04-15')).toBeInTheDocument()
  })

  it('hides the body when collapsed', () => {
    renderRelease()
    expect(screen.queryByText('First feature')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders every section and entry when open', () => {
    renderRelease({ isOpen: true })
    expect(screen.getByText('Added')).toBeInTheDocument()
    expect(screen.getByText('Fixed')).toBeInTheDocument()
    expect(screen.getByText('First feature')).toBeInTheDocument()
    expect(screen.getByText('Second feature')).toBeInTheDocument()
    expect(screen.getByText('A bug')).toBeInTheDocument()
  })

  it('renders the summary when open', () => {
    renderRelease({ isOpen: true })
    expect(screen.getByText('A short description.')).toBeInTheDocument()
  })

  it('calls onToggle when the header is clicked', () => {
    const onToggle = vi.fn()
    renderRelease({ onToggle })
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('marks the running version', () => {
    renderRelease({ isCurrent: true })
    expect(screen.getByText('current')).toBeInTheDocument()
  })

  it('omits the current badge otherwise', () => {
    renderRelease()
    expect(screen.queryByText('current')).not.toBeInTheDocument()
  })

  it('omits the date for a release that has none', () => {
    renderRelease({ release: { ...release, date: null } })
    expect(screen.queryByText('2026-04-15')).not.toBeInTheDocument()
  })

  it('renders an unnamed section without a heading', () => {
    // Bullets parsed with no `###` above them arrive with an empty title.
    renderRelease({
      isOpen: true,
      release: { ...release, sections: [{ title: '', entries: ['Loose bullet'] }] },
    })
    expect(screen.getByText('Loose bullet')).toBeInTheDocument()
  })

  it('renders a release with no summary', () => {
    renderRelease({ isOpen: true, release: { ...release, summary: null } })
    expect(screen.getByText('First feature')).toBeInTheDocument()
    expect(screen.queryByText('A short description.')).not.toBeInTheDocument()
  })

  it('links the header to the panel it controls', () => {
    renderRelease({ isOpen: true })
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const panelId = button.getAttribute('aria-controls')
    expect(document.getElementById(panelId)).toBeTruthy()
  })
})
