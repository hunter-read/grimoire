import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AboutModal from './AboutModal'

// __REACT_VERSION__ is injected by Vite at build time; stub it for tests.
globalThis.__REACT_VERSION__ = '18.3.1'

const defaultStats = {
  version: '1.2.0',
  commit_hash: 'abc123def456789',
  python_version: '3.12.4',
}

function renderModal(props = {}) {
  return render(
    <AboutModal
      stats={defaultStats}
      latestVersion={null}
      hasUpdate={false}
      onClose={vi.fn()}
      {...props}
    />
  )
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('AboutModal — rendering', () => {
  it('renders the About Grimoire heading', () => {
    renderModal()
    expect(screen.getByText('About Grimoire')).toBeInTheDocument()
  })

  it('renders the current version', () => {
    renderModal()
    expect(screen.getByText('v1.2.0')).toBeInTheDocument()
  })

  it('renders the truncated commit hash (first 12 chars)', () => {
    renderModal()
    expect(screen.getByText('abc123def456')).toBeInTheDocument()
  })

  it('does not render commit hash row when commit_hash is empty', () => {
    renderModal({ stats: { ...defaultStats, commit_hash: '' } })
    expect(screen.queryByText(/commit hash/i)).toBeNull()
  })

  it('does not render commit hash row when commit_hash is null', () => {
    renderModal({ stats: { ...defaultStats, commit_hash: null } })
    expect(screen.queryByText(/commit hash/i)).toBeNull()
  })

  it('renders the python version', () => {
    renderModal()
    expect(screen.getByText('3.12.4')).toBeInTheDocument()
  })

  it('renders the react version from __REACT_VERSION__', () => {
    renderModal()
    expect(screen.getByText('18.3.1')).toBeInTheDocument()
  })

  it('renders a View Release link', () => {
    renderModal()
    expect(screen.getByRole('link', { name: /view release/i })).toBeInTheDocument()
  })

  it('View Release link points to the correct release URL', () => {
    renderModal()
    const link = screen.getByRole('link', { name: /view release/i })
    expect(link).toHaveAttribute('href', 'https://github.com/hunter-read/grimoire/releases/tag/v1.2.0')
  })

  it('renders a GitHub repository link', () => {
    renderModal()
    expect(screen.getByRole('link', { name: /github repository/i })).toBeInTheDocument()
  })

  it('GitHub link points to the repo root', () => {
    renderModal()
    const link = screen.getByRole('link', { name: /github repository/i })
    expect(link).toHaveAttribute('href', 'https://github.com/hunter-read/grimoire')
  })

  it('renders a close button', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('renders fallback dashes when stats is null', () => {
    renderModal({ stats: null })
    // version shows '—' when stats is null
    expect(screen.getByText('v—')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Update available row
// ---------------------------------------------------------------------------

describe('AboutModal — update available', () => {
  it('does not render the update row when hasUpdate is false', () => {
    renderModal({ hasUpdate: false })
    expect(screen.queryByText(/update available/i)).toBeNull()
  })

  it('renders the update row when hasUpdate is true', () => {
    renderModal({ hasUpdate: true, latestVersion: '2.0.0' })
    expect(screen.getByText(/update available/i)).toBeInTheDocument()
  })

  it('shows the latest version number in the update row', () => {
    renderModal({ hasUpdate: true, latestVersion: '2.0.0' })
    expect(screen.getByText('v2.0.0')).toBeInTheDocument()
  })

  it('update row links to the latest release', () => {
    renderModal({ hasUpdate: true, latestVersion: '2.0.0' })
    const link = screen.getByRole('link', { name: 'v2.0.0' })
    expect(link).toHaveAttribute('href', 'https://github.com/hunter-read/grimoire/releases/tag/v2.0.0')
  })
})

// ---------------------------------------------------------------------------
// Close behaviour
// ---------------------------------------------------------------------------

describe('AboutModal — close behaviour', () => {
  it('calls onClose when the X button is clicked', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not call onClose when clicking inside the modal card', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByText('About Grimoire'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('AboutModal — accessibility', () => {
  it('has role="dialog"', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('has aria-modal="true"', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('is labelled by the heading element', () => {
    renderModal()
    const dialog = screen.getByRole('dialog')
    const labelId = dialog.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    const label = document.getElementById(labelId)
    expect(label).toBeInTheDocument()
    expect(label.textContent).toMatch(/About Grimoire/i)
  })

  it('both external links open in a new tab', () => {
    renderModal({ hasUpdate: true, latestVersion: '2.0.0' })
    const links = screen.getAllByRole('link')
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer')
    }
  })
})
