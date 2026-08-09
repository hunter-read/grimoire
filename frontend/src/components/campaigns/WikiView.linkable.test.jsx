import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import WikiView from './WikiView'

vi.mock('../../api', () => ({
  default: { get: vi.fn(() => Promise.resolve({})) },
  mediaUrl: (path) => `http://localhost${path}`,
  campaigns: {
    listWikiPages: vi.fn(),
    getWikiPage: vi.fn(),
    updateWikiPage: vi.fn(),
    reorderWikiPages: vi.fn(),
    createWikiPage: vi.fn(),
    deleteWikiPage: vi.fn(),
    exportWiki: vi.fn(),
    wikiTemplates: vi.fn(),
    useWikiTemplate: vi.fn(),
    getWikiTemplate: vi.fn(),
    fileUrl: (cid, id) => `http://localhost/campaigns/${cid}/files/${id}`,
  },
}))

vi.mock('../../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({
    playQueue: vi.fn(),
    playNext: vi.fn(),
    togglePlay: vi.fn(),
    isCurrent: () => false,
    isPlayingId: () => false,
  }),
}))

import { campaigns } from '../../api'

const campaign = { id: 'c1', name: 'Test', members: [] }

const makePage = (over = {}) => ({
  id: 'p1',
  title: 'Dragons',
  slug: 'dragons',
  visibility: 'gm',
  parent_id: null,
  icon: null,
  can_edit: true,
  body: 'Here be dragons',
  backlinks: [],
  ...over,
})

const dragons = makePage()
const goblins = makePage({ id: 'p2', title: 'Goblins', slug: 'goblins', body: 'Small and mean' })

// Surfaces the live URL so assertions can read the ?note= param.
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="loc">{location.pathname + location.search}</span>
}

function renderAt(entry = '/campaigns/c1/notes') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/campaigns/:campaignId/notes"
          element={<WikiView campaign={campaign} isOwner />}
        />
      </Routes>
    </MemoryRouter>
  )
}

const url = () => screen.getByTestId('loc').textContent

describe('WikiView linkable notes (issue #313)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.listWikiPages.mockResolvedValue([dragons, goblins])
    campaigns.getWikiPage.mockImplementation((_cid, id) =>
      Promise.resolve(id === 'p2' ? goblins : dragons)
    )
  })

  it('opens the note named by ?note= on load, not the first page', async () => {
    renderAt('/campaigns/c1/notes?note=p2')

    await waitFor(() => expect(screen.getByText('Small and mean')).toBeInTheDocument())
    expect(campaigns.getWikiPage).toHaveBeenCalledWith('c1', 'p2')
  })

  it('puts the note id in the URL when one is selected from the sidebar', async () => {
    renderAt()

    // Desktop auto-opens the first page, which is itself recorded in the URL.
    await waitFor(() => expect(url()).toContain('note=p1'))

    await userEvent.click(screen.getByRole('button', { name: 'Goblins' }))

    await waitFor(() => expect(url()).toContain('note=p2'))
    expect(url()).toBe('/campaigns/c1/notes?note=p2')
  })

  it('keeps the note in the URL across a back/forward-style remount', async () => {
    const { unmount } = renderAt()
    await waitFor(() => expect(url()).toContain('note=p1'))
    unmount()

    // Re-entering at that URL restores the same note — the point of linkability.
    renderAt('/campaigns/c1/notes?note=p2')
    await waitFor(() => expect(screen.getByText('Small and mean')).toBeInTheDocument())
  })

  // Selection replaces rather than pushes, so browsing the sidebar doesn't bury
  // the page the user arrived from under one back-step per note they clicked.
  it('replaces history rather than pushing an entry per note opened', async () => {
    const seenIdx = []
    function IdxProbe() {
      // `idx` is react-router's position in the history stack; it advances on a
      // push and stays put on a replace.
      const location = useLocation()
      seenIdx.push(location.idx ?? window.history.state?.idx ?? 0)
      return null
    }
    render(
      <MemoryRouter initialEntries={['/campaigns/c1/notes']}>
        <LocationProbe />
        <IdxProbe />
        <Routes>
          <Route
            path="/campaigns/:campaignId/notes"
            element={<WikiView campaign={campaign} isOwner />}
          />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => expect(url()).toContain('note=p1'))
    await userEvent.click(screen.getByRole('button', { name: 'Goblins' }))
    await waitFor(() => expect(url()).toContain('note=p2'))

    // Two notes were opened, yet the stack never grew past its starting entry.
    expect(new Set(seenIdx).size).toBe(1)
  })

  describe('opening a note in a new tab', () => {
    let open

    beforeEach(() => {
      open = vi.spyOn(window, 'open').mockImplementation(() => null)
    })

    afterEach(() => open.mockRestore())

    it('middle click on a sidebar row opens that note in a new tab', async () => {
      renderAt()
      await waitFor(() => expect(url()).toContain('note=p1'))

      await userEvent.pointer({
        target: screen.getByRole('button', { name: 'Goblins' }),
        keys: '[MouseMiddle]',
      })

      expect(open).toHaveBeenCalledWith(
        '/campaigns/c1/notes?note=p2',
        '_blank',
        'noopener,noreferrer'
      )
      // The current tab stays on the note it was already showing.
      expect(url()).toBe('/campaigns/c1/notes?note=p1')
    })

    it('exposes each sidebar row target as data-href', async () => {
      renderAt()
      await waitFor(() => expect(url()).toContain('note=p1'))

      expect(screen.getByRole('button', { name: 'Goblins' })).toHaveAttribute(
        'data-href',
        '/campaigns/c1/notes?note=p2'
      )
    })

    it('middle click on a backlink chip opens that note in a new tab', async () => {
      campaigns.getWikiPage.mockResolvedValue(
        makePage({ backlinks: [{ id: 'p2', title: 'Goblins' }] })
      )
      renderAt()

      const chip = await screen.findByRole('button', { name: 'Goblins' })
      await userEvent.pointer({ target: chip, keys: '[MouseMiddle]' })

      expect(open).toHaveBeenCalledWith(
        '/campaigns/c1/notes?note=p2',
        '_blank',
        'noopener,noreferrer'
      )
    })

    it('plain click on a backlink chip still opens it in place', async () => {
      campaigns.getWikiPage.mockImplementation((_cid, id) =>
        Promise.resolve(
          id === 'p2' ? goblins : makePage({ backlinks: [{ id: 'p2', title: 'Goblins' }] })
        )
      )
      renderAt()

      const chip = await screen.findByRole('button', { name: 'Goblins' })
      await userEvent.click(chip)

      await waitFor(() => expect(url()).toContain('note=p2'))
      expect(open).not.toHaveBeenCalled()
    })
  })
})
