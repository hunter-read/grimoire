import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// WikiView reads a mobile flag via useIsMobile(); stub matchMedia to report a
// phone BEFORE importing the component so the full-screen tree/note swap is
// exercised, then load it dynamically.
vi.mock('../../api', () => ({
  campaigns: {
    listWikiPages: vi.fn(),
    getWikiPage: vi.fn(),
    updateWikiPage: vi.fn(),
    reorderWikiPages: vi.fn(),
    createWikiPage: vi.fn(),
    deleteWikiPage: vi.fn(),
  },
}))
vi.mock('../../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({ playQueue: vi.fn() }),
}))

import { campaigns, type Schema } from '../../api'

// The api module is mocked above; reach its helpers as plain vi.fn()s.
const campaignsMock = campaigns as unknown as Record<keyof typeof campaigns, Mock>

const campaign = { id: 'c1', name: 'Test', members: [] } as unknown as Schema<'CampaignOut'>
const pageA = {
  id: 'p1',
  title: 'Gunnar Mountainson',
  slug: 'gunnar',
  visibility: 'gm',
  parent_id: null,
  icon: null,
  can_edit: true,
  body: 'Ancestry: Hakaan',
  backlinks: [],
}

let WikiView: typeof import('./WikiView').default

beforeAll(async () => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })
  vi.resetModules()
  WikiView = (await import('./WikiView')).default
})

const renderView = (props = {}) =>
  render(
    <MemoryRouter>
      <WikiView campaign={campaign} isOwner {...props} />
    </MemoryRouter>
  )

describe('WikiView mobile full-screen swap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    campaignsMock.listWikiPages.mockResolvedValue([pageA])
    campaignsMock.getWikiPage.mockResolvedValue(pageA)
  })

  it('lands on the page tree (does not auto-open the first note) on mobile', async () => {
    renderView()
    // The tree row for the page is shown...
    await screen.findByText('Gunnar Mountainson')
    // ...but the note body is NOT auto-loaded.
    expect(campaigns.getWikiPage).not.toHaveBeenCalled()
    expect(screen.queryByText('Ancestry: Hakaan')).not.toBeInTheDocument()
  })

  it('opens the note full-screen when a page is tapped, then returns via "Pages"', async () => {
    renderView()
    const row = await screen.findByText('Gunnar Mountainson')
    fireEvent.click(row)

    // Note content loads and the back-to-pages button appears.
    await screen.findByText('Ancestry: Hakaan')
    const back = screen.getByRole('button', { name: /pages/i })
    expect(back).toBeInTheDocument()

    fireEvent.click(back)
    // Back on the list: the note is gone, the tree row is shown again.
    await waitFor(() => expect(screen.queryByText('Ancestry: Hakaan')).not.toBeInTheDocument())
    expect(screen.getByText('Gunnar Mountainson')).toBeInTheDocument()
  })

  it('reports viewing-note state so the parent can hide its header', async () => {
    const onViewingNoteChange = vi.fn()
    renderView({ onViewingNoteChange })
    // Starts on the list → not viewing a note.
    await screen.findByText('Gunnar Mountainson')
    await waitFor(() => expect(onViewingNoteChange).toHaveBeenLastCalledWith(false))

    fireEvent.click(screen.getByText('Gunnar Mountainson'))
    await screen.findByText('Ancestry: Hakaan')
    // Opening the note reports true.
    await waitFor(() => expect(onViewingNoteChange).toHaveBeenLastCalledWith(true))

    fireEvent.click(screen.getByRole('button', { name: /pages/i }))
    // Returning to the list reports false again.
    await waitFor(() => expect(onViewingNoteChange).toHaveBeenLastCalledWith(false))
  })
})
