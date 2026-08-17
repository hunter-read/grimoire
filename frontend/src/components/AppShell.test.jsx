import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppShell from './AppShell'

vi.mock('../api', () => ({
  default: { get: vi.fn().mockResolvedValue({ books: 1 }) },
  settings: { getUi: vi.fn().mockResolvedValue({ hide_audio: false }) },
}))
let role = 'admin'
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role }, logout: vi.fn() }),
}))
let queue = []
vi.mock('../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({ queue }),
}))
vi.mock('../context/UISettingsContext', () => ({
  UISettingsProvider: ({ children }) => children,
}))
vi.mock('../hooks/useScrollRestoration', () => ({ default: () => ({ current: null }) }))
vi.mock('./Sidebar', () => ({ default: () => <nav>sidebar</nav> }))
vi.mock('./MobileSidebar', () => ({ default: () => <nav>mobile-nav</nav> }))
vi.mock('./audio/GlobalAudioPlayer', () => ({
  default: () => <div data-testid="global-player" />,
  PLAYER_HEIGHT: 72,
}))
// Stub all routed views so we only test the shell.
vi.mock('./BookReader', () => ({ default: () => <div>reader</div> }))
vi.mock('../views/LibraryView', () => ({ default: () => <div>library</div> }))
vi.mock('../views/SystemDetailView', () => ({ default: () => <div>system</div> }))
vi.mock('../views/MapsView', () => ({ default: () => <div>maps</div> }))
vi.mock('./maps/MapDetailView', () => ({ default: () => <div>map-detail</div> }))
vi.mock('../views/TokensView', () => ({ default: () => <div>tokens</div> }))
vi.mock('./tokens/TokenDetailView', () => ({ default: () => <div>token-detail</div> }))
vi.mock('../views/AudioView', () => ({ default: () => <div>audio</div> }))
vi.mock('./audio/AudioDetailView', () => ({ default: () => <div>audio-detail</div> }))
vi.mock('../views/SearchView', () => ({ default: () => <div>search</div> }))
vi.mock('../views/SettingsView', () => ({ default: () => <div>settings</div> }))
vi.mock('../views/FavoritesView', () => ({ default: () => <div>favorites</div> }))
vi.mock('../views/CampaignsView', () => ({ default: () => <div>campaigns</div> }))
vi.mock('../views/CampaignDetailView', () => ({ default: () => <div>campaign-detail</div> }))
vi.mock('../views/CampaignNotesView', () => ({ default: () => <div>campaign-notes</div> }))
vi.mock('./campaigns/PendingInvitesBanner', () => ({ default: () => null }))

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  queue = []
  role = 'admin'
  window.innerWidth = 1200 // desktop
})

describe('AppShell', () => {
  it('renders the sidebar and the audio route on desktop', async () => {
    renderAt('/audio')
    await waitFor(() => expect(screen.getByText('sidebar')).toBeInTheDocument())
    expect(screen.getByText('audio')).toBeInTheDocument()
    expect(screen.getByTestId('global-player')).toBeInTheDocument()
  })

  it('routes to the audio detail view', async () => {
    renderAt('/audio/a1')
    await waitFor(() => expect(screen.getByText('audio-detail')).toBeInTheDocument())
  })

  it('renders the mobile nav on small screens', async () => {
    window.innerWidth = 500
    renderAt('/library')
    await waitFor(() => expect(screen.getByText('mobile-nav')).toBeInTheDocument())
  })

  it('keeps the player mounted when a queue is active', async () => {
    queue = [{ id: 'a' }]
    renderAt('/search')
    await waitFor(() => expect(screen.getByTestId('global-player')).toBeInTheDocument())
  })

  // Issue #361: a guest clicking a public campaign resource fell through to the
  // catch-all and was bounced back to the campaign list instead of opening it.
  describe('guest routes', () => {
    beforeEach(() => {
      role = 'guest'
    })

    it.each([
      ['/library/book/b1', 'reader'],
      ['/maps/m1', 'map-detail'],
      ['/tokens/t1', 'token-detail'],
      ['/audio/a1', 'audio-detail'],
    ])('opens %s for a guest', async (path, expected) => {
      renderAt(path)
      await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument())
      expect(screen.queryByText('campaigns')).not.toBeInTheDocument()
    })

    it.each(['/library', '/maps', '/tokens', '/audio', '/search', '/settings/account'])(
      'still redirects a guest away from %s',
      async (path) => {
        renderAt(path)
        await waitFor(() => expect(screen.getByText('campaigns')).toBeInTheDocument())
      }
    )

    it('still renders the guest campaign detail view', async () => {
      renderAt('/campaigns/c1/overview')
      await waitFor(() => expect(screen.getByText('campaign-detail')).toBeInTheDocument())
    })
  })
})
