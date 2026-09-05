import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from './Sidebar'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Stub AboutModal so Sidebar tests don't need to worry about portal/modal internals
vi.mock('./AboutModal', () => ({
  default: ({ onClose }) => (
    <div data-testid="about-modal">
      <button onClick={onClose}>Close About</button>
    </div>
  ),
}))

// The update check goes through our backend proxy (api.get('/latest-release')).
vi.mock('../api', () => ({
  default: { get: vi.fn() },
}))

import api from '../api'

const DISMISSED_KEY = 'grimoire_update_dismissed'

const baseStats = {
  game_systems: 5,
  books: 42,
  total_pages: 10000,
  maps: 8,
  tokens: 30,
  total_size_mb: 512,
  library_size_mb: 2048,
}

const baseAbout = {
  version: '1.2.0',
  commit_hash: 'abc123def456',
  python_version: '3.12.0',
}

const baseUser = { username: 'jdoe', display_name: 'Jane Doe', role: 'player' }

// Drive the update check: resolve api.get('/latest-release') with the given
// version (tag_name-style "v2.0.0" accepted for parity with the old fixtures),
// or reject to simulate an unreachable backend.
function mockLatest(tagName = null, { reject = false } = {}) {
  if (reject) {
    api.get.mockRejectedValue(new Error('network error'))
    return
  }
  api.get.mockResolvedValue({
    latest_version: tagName ? tagName.replace(/^v/, '') : null,
  })
}

function renderSidebar(props = {}) {
  return render(
    <MemoryRouter>
      <Sidebar
        user={baseUser}
        onLogout={vi.fn()}
        stats={baseStats}
        about={baseAbout}
        uiSettings={{}}
        {...props}
      />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  // Default: no newer release, so no update banner appears
  mockLatest(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// User display (existing)
// ---------------------------------------------------------------------------

describe('Sidebar user display', () => {
  it('shows display_name when set', () => {
    renderSidebar()
    expect(screen.getByText('Jane Doe')).toBeTruthy()
    expect(screen.queryByText('jdoe')).toBeNull()
  })

  it('falls back to username when display_name is not set', () => {
    renderSidebar({ user: { username: 'jdoe', display_name: null, role: 'player' } })
    expect(screen.getByText('jdoe')).toBeTruthy()
  })

  it('falls back to username when display_name is empty string', () => {
    renderSidebar({ user: { username: 'jdoe', display_name: '', role: 'player' } })
    expect(screen.getByText('jdoe')).toBeTruthy()
  })

  it('shows user role', () => {
    renderSidebar({ user: { username: 'jdoe', display_name: null, role: 'admin' } })
    expect(screen.getByText('admin')).toBeTruthy()
  })

  it('renders nothing in the user section when user is null', () => {
    renderSidebar({ user: null })
    expect(screen.queryByLabelText('Log out')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Navigation visibility (existing)
// ---------------------------------------------------------------------------

describe('Sidebar navigation visibility', () => {
  it('shows campaigns link by default', () => {
    renderSidebar()
    expect(screen.getByText('Campaigns')).toBeTruthy()
  })

  it('hides campaigns link when hide_campaigns is true', () => {
    renderSidebar({ uiSettings: { hide_campaigns: true } })
    expect(screen.queryByText('Campaigns')).toBeNull()
  })

  it('hides maps link when hide_maps is true', () => {
    renderSidebar({ uiSettings: { hide_maps: true } })
    expect(screen.queryByText('Maps')).toBeNull()
  })

  it('shows the Tags link pointing at /tags (issue #235)', () => {
    renderSidebar()
    const tagsLink = screen.getByRole('link', { name: 'Tags' })
    expect(tagsLink).toHaveAttribute('href', '/tags')
  })

  it('does not show the Tags link for guests', () => {
    renderSidebar({ user: { ...baseUser, role: 'guest' } })
    expect(screen.queryByRole('link', { name: 'Tags' })).toBeNull()
    // Guests still see campaigns.
    expect(screen.getByText('Campaigns')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Version row
// ---------------------------------------------------------------------------

describe('Sidebar version row', () => {
  it('renders the version button when stats are provided', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: /about grimoire/i })).toBeInTheDocument()
  })

  it('displays the current version string', () => {
    renderSidebar()
    expect(screen.getByText('v1.2.0')).toBeInTheDocument()
  })

  it('does not render the version button when about is null', () => {
    renderSidebar({ about: null })
    expect(screen.queryByRole('button', { name: /about grimoire/i })).toBeNull()
  })

  it('opens the About modal when the version button is clicked', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /about grimoire/i }))
    expect(screen.getByTestId('about-modal')).toBeInTheDocument()
  })

  it('closes the About modal when onClose is called', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /about grimoire/i }))
    fireEvent.click(screen.getByRole('button', { name: /close about/i }))
    expect(screen.queryByTestId('about-modal')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Stats footer
// ---------------------------------------------------------------------------

describe('Sidebar stats footer', () => {
  it('shows systems stat when show_stat_systems is true', () => {
    renderSidebar({ uiSettings: { show_stat_systems: true } })
    expect(screen.getByText('Systems')).toBeInTheDocument()
  })

  it('hides systems stat when show_stat_systems is false', () => {
    renderSidebar({
      uiSettings: { show_stat_systems: false, show_stat_pages: false, show_stat_size: false },
    })
    expect(screen.queryByText('Systems')).toBeNull()
  })

  it('shows pages stat by default', () => {
    renderSidebar()
    expect(screen.getByText('Pages')).toBeInTheDocument()
  })

  it('labels the books-only size stat and shows its value', () => {
    renderSidebar({ uiSettings: { show_stat_size: true } })
    expect(screen.getByText('Books Size')).toBeInTheDocument()
    expect(screen.getByText('512 MB')).toBeInTheDocument()
  })

  it('hides the library size stat by default', () => {
    renderSidebar()
    expect(screen.queryByText('Library Size')).toBeNull()
  })

  it('shows the library size stat, in GB, when enabled', () => {
    renderSidebar({ uiSettings: { show_stat_library_size: true } })
    expect(screen.getByText('Library Size')).toBeInTheDocument()
    expect(screen.getByText('2.00 GB')).toBeInTheDocument()
  })

  it('renders the stats footer when library size is the only stat enabled', () => {
    renderSidebar({
      uiSettings: {
        show_stat_systems: false,
        show_stat_pages: false,
        show_stat_size: false,
        show_stat_library_size: true,
      },
    })
    expect(screen.getByText('Library Size')).toBeInTheDocument()
  })

  it('version does not appear in the stats footer section', () => {
    // Version is now always in its own row below, not a toggled stat
    renderSidebar({
      uiSettings: { show_stat_systems: false, show_stat_pages: false, show_stat_size: false },
    })
    // Version button should still exist (it's always rendered when stats is set)
    expect(screen.getByRole('button', { name: /about grimoire/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Update banner — fetch success
// ---------------------------------------------------------------------------

describe('Sidebar update banner', () => {
  it('shows update banner when a newer version is available', async () => {
    mockLatest('v2.0.0')
    renderSidebar()
    await waitFor(() => {
      expect(screen.getByText(/update available/i)).toBeInTheDocument()
    })
    expect(screen.getByText('v2.0.0')).toBeInTheDocument()
  })

  it('does not show update banner when already on the latest version', async () => {
    mockLatest('v1.2.0') // same as baseStats.version
    renderSidebar()
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/latest-release')
    })
    expect(screen.queryByText(/update available/i)).toBeNull()
  })

  it('does not show update banner when current version is newer than remote', async () => {
    mockLatest('v1.1.0')
    renderSidebar()
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/latest-release')
    })
    expect(screen.queryByText(/update available/i)).toBeNull()
  })

  it('does not show update banner when fetch fails', async () => {
    mockLatest(null, { reject: true })
    renderSidebar()
    // Give time for fetch to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(screen.queryByText(/update available/i)).toBeNull()
  })

  it('does not show update banner when stats version is "dev"', async () => {
    mockLatest('v2.0.0')
    renderSidebar({ stats: { ...baseStats, version: 'dev' } })
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/latest-release')
    })
    expect(screen.queryByText(/update available/i)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Update banner — dismiss
// ---------------------------------------------------------------------------

describe('Sidebar update banner dismiss', () => {
  it('hides the banner when X is clicked', async () => {
    mockLatest('v2.0.0')
    renderSidebar()
    await waitFor(() => {
      expect(screen.getByText(/update available/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByText(/update available/i)).toBeNull()
  })

  it('saves the dismissed version to localStorage when X is clicked', async () => {
    mockLatest('v2.0.0')
    renderSidebar()
    await waitFor(() => {
      expect(screen.getByText(/update available/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('2.0.0')
  })

  it('does not show banner on mount when that version was already dismissed', async () => {
    localStorage.setItem(DISMISSED_KEY, '2.0.0')
    mockLatest('v2.0.0')
    renderSidebar()
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/latest-release')
    })
    expect(screen.queryByText(/update available/i)).toBeNull()
  })

  it('shows banner again when a newer version than the dismissed one is available', async () => {
    localStorage.setItem(DISMISSED_KEY, '2.0.0')
    mockLatest('v2.1.0')
    renderSidebar()
    await waitFor(() => {
      expect(screen.getByText(/update available/i)).toBeInTheDocument()
    })
  })
})
