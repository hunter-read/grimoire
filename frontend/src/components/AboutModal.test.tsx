import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AboutModal from './AboutModal'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

// __REACT_VERSION__ is injected by Vite at build time; stub it for tests.
globalThis.__REACT_VERSION__ = '18.3.1'

const CHANGELOG = {
  releases: [
    {
      version: '1.2.0',
      date: '2026-04-15',
      summary: 'The release that is running.',
      sections: [{ title: 'Added', entries: ['A shiny feature'] }],
    },
    {
      version: '1.1.0',
      date: '2026-04-10',
      summary: null,
      sections: [{ title: 'Fixed', entries: ['An old bug'] }],
    },
  ],
}

beforeEach(() => {
  api.get.mockReset()
  api.get.mockResolvedValue(CHANGELOG)
})

const defaultAbout = {
  version: '1.2.0',
  commit_hash: 'abc123def456789',
  python_version: '3.12.4',
}

function renderModal(props = {}) {
  return render(
    <AboutModal
      about={defaultAbout}
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
    renderModal({ about: { ...defaultAbout, commit_hash: '' } })
    expect(screen.queryByText(/commit hash/i)).toBeNull()
  })

  it('does not render commit hash row when commit_hash is null', () => {
    renderModal({ about: { ...defaultAbout, commit_hash: null } })
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
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/hunter-read/grimoire/releases/tag/v1.2.0'
    )
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

  it('renders a documentation link', () => {
    renderModal()
    expect(screen.getByRole('link', { name: /documentation/i })).toBeInTheDocument()
  })

  it('documentation link points to the docs site', () => {
    renderModal()
    const link = screen.getByRole('link', { name: /documentation/i })
    expect(link).toHaveAttribute('href', 'https://docs.grimoirecodex.org')
  })

  it('renders a close button', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('renders fallback dashes when stats is null', () => {
    renderModal({ about: null })
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
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/hunter-read/grimoire/releases/tag/v2.0.0'
    )
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

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

describe('AboutModal — changelog', () => {
  it('lists every release from the API', async () => {
    renderModal()
    expect(await screen.findByText('1.2.0')).toBeInTheDocument()
    expect(screen.getByText('1.1.0')).toBeInTheDocument()
  })

  it('expands the running version and marks it current', async () => {
    renderModal()
    // The running release's body is open without any interaction…
    expect(await screen.findByText('A shiny feature')).toBeInTheDocument()
    expect(screen.getByText('current')).toBeInTheDocument()
    // …while an older one stays collapsed.
    expect(screen.queryByText('An old bug')).not.toBeInTheDocument()
  })

  it('renders a release summary when it has one', async () => {
    renderModal()
    expect(await screen.findByText('The release that is running.')).toBeInTheDocument()
  })

  it('expands and collapses a release when its header is clicked', async () => {
    renderModal()
    const older = await screen.findByRole('button', { name: /1\.1\.0/ })

    fireEvent.click(older)
    expect(await screen.findByText('An old bug')).toBeInTheDocument()
    expect(older).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(older)
    expect(screen.queryByText('An old bug')).not.toBeInTheDocument()
    expect(older).toHaveAttribute('aria-expanded', 'false')
  })

  it('collapses the current release when clicked', async () => {
    renderModal()
    const current = await screen.findByRole('button', { name: /1\.2\.0/ })
    fireEvent.click(current)
    expect(screen.queryByText('A shiny feature')).not.toBeInTheDocument()
  })

  it('omits the changelog when the API returns none', async () => {
    api.get.mockResolvedValue({ releases: [] })
    renderModal()
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.queryByText('Changelog')).not.toBeInTheDocument()
  })

  it('still shows build information when the changelog fails to load', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    renderModal()
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    // The dialog's actual purpose survives a failed changelog fetch.
    expect(screen.getByText('v1.2.0')).toBeInTheDocument()
    expect(screen.queryByText('Changelog')).not.toBeInTheDocument()
  })

  it('marks no release current when the running version is absent', async () => {
    api.get.mockResolvedValue({
      releases: [{ version: '9.9.9', date: null, summary: null, sections: [] }],
    })
    renderModal()
    expect(await screen.findByText('9.9.9')).toBeInTheDocument()
    expect(screen.queryByText('current')).not.toBeInTheDocument()
  })
})
