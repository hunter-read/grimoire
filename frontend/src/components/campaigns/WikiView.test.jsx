import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, createEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WikiView from './WikiView'

// jsdom's synthetic drag events drop clientY, so build the event explicitly and
// pin clientY on it — that's what the row's drop-zone math reads.
function fireDragAt(type, el, clientY) {
  const ev = createEvent[type](el)
  Object.defineProperty(ev, 'clientY', { value: clientY })
  fireEvent(el, ev)
}

vi.mock('../../api', () => ({
  campaigns: {
    listWikiPages: vi.fn(),
    getWikiPage: vi.fn(),
    updateWikiPage: vi.fn(),
    reorderWikiPages: vi.fn(),
    createWikiPage: vi.fn(),
    deleteWikiPage: vi.fn(),
    exportWiki: vi.fn(),
  },
}))

const playQueue = vi.fn()
vi.mock('../../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({
    playQueue,
    playNext: vi.fn(),
    togglePlay: vi.fn(),
    isCurrent: () => false,
    isPlayingId: () => false,
  }),
}))

import { campaigns } from '../../api'

const campaign = { id: 'c1', name: 'Test', members: [] }

const page = {
  id: 'p1',
  title: 'Dragons',
  slug: 'dragons',
  visibility: 'gm',
  parent_id: null,
  icon: null,
  can_edit: true,
  body: 'Here be dragons',
  backlinks: [],
}

function renderView(props = {}) {
  return render(
    <MemoryRouter>
      <WikiView campaign={campaign} isOwner {...props} />
    </MemoryRouter>
  )
}

describe('WikiView quick icon picker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.listWikiPages.mockResolvedValue([page])
    campaigns.getWikiPage.mockResolvedValue(page)
    campaigns.updateWikiPage.mockResolvedValue(page)
  })

  it('opens the icon picker from a sidebar row without re-selecting the page', async () => {
    renderView()
    // Wait for the first page to auto-load, then forget that initial fetch.
    await screen.findByText('Here be dragons')
    campaigns.getWikiPage.mockClear()

    // The sidebar icon trigger carries the wiki icon aria-label.
    const triggers = await screen.findAllByRole('button', { name: 'Icon' })
    fireEvent.click(triggers[0])

    // The picker popover exposes a "No icon" option and the curated grid.
    expect(await screen.findByRole('button', { name: 'No icon' })).toBeTruthy()
    // Clicking the icon must not have triggered a page-select (which fetches it).
    expect(campaigns.getWikiPage).not.toHaveBeenCalled()
  })

  it('saves the chosen icon via updateWikiPage', async () => {
    renderView()
    const triggers = await screen.findAllByRole('button', { name: 'Icon' })
    fireEvent.click(triggers[0])

    const sword = await screen.findByRole('button', { name: 'swords' })
    fireEvent.click(sword)

    await waitFor(() =>
      expect(campaigns.updateWikiPage).toHaveBeenCalledWith('c1', 'p1', { icon: 'swords' })
    )
  })

  it('shows a static icon (no picker) for rows the user cannot edit', async () => {
    campaigns.listWikiPages.mockResolvedValue([{ ...page, can_edit: false }])
    campaigns.getWikiPage.mockResolvedValue({ ...page, can_edit: false })
    renderView({ isOwner: false })
    await screen.findByText('Dragons')
    expect(screen.queryByRole('button', { name: 'Icon' })).toBeNull()
  })
})

describe('WikiView visibility editor', () => {
  const campaignWithMembers = {
    id: 'c1',
    name: 'Test',
    members: [
      { user_id: 'u1', is_owner: true, username: 'gm' },
      { user_id: 'u2', is_owner: false, username: 'alice' },
      { user_id: 'u3', is_owner: false, username: 'bob' },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.listWikiPages.mockResolvedValue([page])
    campaigns.getWikiPage.mockResolvedValue({ ...page, shared_user_ids: [] })
    campaigns.updateWikiPage.mockResolvedValue(page)
  })

  it('opens a dropdown to change the visibility level', async () => {
    renderView()
    const badge = await screen.findByRole('button', { name: 'Change visibility' })
    fireEvent.click(badge)

    // Owner sees all three levels with the renamed labels.
    const publicOpt = await screen.findByRole('menuitemradio', { name: /Public/ })
    fireEvent.click(publicOpt)

    await waitFor(() =>
      expect(campaigns.updateWikiPage).toHaveBeenCalledWith('c1', 'p1', {
        visibility: 'group',
        shared_user_ids: [],
      })
    )
  })

  it('toggles member access when the page is Private', async () => {
    campaigns.getWikiPage.mockResolvedValue({
      ...page,
      visibility: 'members',
      shared_user_ids: [],
    })
    render(
      <MemoryRouter>
        <WikiView campaign={campaignWithMembers} isOwner />
      </MemoryRouter>
    )
    const badge = await screen.findByRole('button', { name: 'Change visibility' })
    fireEvent.click(badge)

    // Non-owner members appear as toggleable access rows.
    const alice = await screen.findByRole('menuitemcheckbox', { name: 'alice' })
    fireEvent.click(alice)

    await waitFor(() =>
      expect(campaigns.updateWikiPage).toHaveBeenCalledWith('c1', 'p1', {
        shared_user_ids: ['u2'],
      })
    )
  })

  it('shows a read-only badge for pages the user cannot edit', async () => {
    campaigns.listWikiPages.mockResolvedValue([{ ...page, can_edit: false }])
    campaigns.getWikiPage.mockResolvedValue({ ...page, can_edit: false })
    renderView({ isOwner: false })
    await screen.findByText('Here be dragons')
    expect(screen.queryByRole('button', { name: 'Change visibility' })).toBeNull()
  })

  it('tints the page-title icon with the page’s own colour, not its visibility', async () => {
    // Visibility is carried by its own glyph now; the icon colour is a user
    // choice, so it must be identical across visibility levels.
    for (const visibility of ['gm', 'group', 'members']) {
      campaigns.getWikiPage.mockResolvedValue({
        ...page,
        visibility,
        icon_color: 'blue',
        shared_user_ids: [],
      })
      const { unmount } = renderView()
      await screen.findByRole('button', { name: 'Change visibility' })
      const iconBtn = screen.getAllByRole('button', { name: 'Icon' }).at(-1)
      expect(iconBtn.style.color).toBe('rgb(85, 144, 212)') // preset "blue"
      unmount()
    }
  })

  it('leaves the page-title icon untinted when no colour is set', async () => {
    campaigns.getWikiPage.mockResolvedValue({ ...page, icon_color: null, shared_user_ids: [] })
    renderView()
    await screen.findByRole('button', { name: 'Change visibility' })
    const iconBtn = screen.getAllByRole('button', { name: 'Icon' }).at(-1)
    expect(iconBtn.style.color).toBe('var(--text-dim)')
  })
})

describe('WikiView nested tree', () => {
  const parent = { ...page, id: 'parent', title: 'Bestiary', slug: 'bestiary' }
  const child = {
    ...page,
    id: 'child',
    title: 'Goblins',
    slug: 'goblins',
    parent_id: 'parent',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    campaigns.listWikiPages.mockResolvedValue([parent, child])
    campaigns.getWikiPage.mockResolvedValue(parent)
    campaigns.updateWikiPage.mockResolvedValue(parent)
  })

  it('renders children under their parent and collapses/expands them', async () => {
    renderView()
    await screen.findByText('Bestiary')
    // Child is visible by default (expanded).
    expect(screen.getByText('Goblins')).toBeTruthy()

    // Collapsing the parent hides its child.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByText('Goblins')).toBeNull()

    // Expanding brings it back.
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(screen.getByText('Goblins')).toBeTruthy()
  })

  it('remembers collapse state per browser across remounts', async () => {
    const { unmount } = renderView()
    await screen.findByText('Bestiary')

    // Collapse the parent, which persists to localStorage.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByText('Goblins')).toBeNull()
    expect(JSON.parse(localStorage.getItem('grimoire_wiki_collapsed_c1'))).toContain('parent')

    // Remounting (e.g. navigating back) restores the collapsed state.
    unmount()
    renderView()
    await screen.findByText('Bestiary')
    expect(screen.queryByText('Goblins')).toBeNull()
  })

  it('creates a subpage under a parent via the row + button', async () => {
    renderView()
    await screen.findByText('Bestiary')
    // Each owner row has an "Add subpage" button; click the parent's.
    fireEvent.click(screen.getAllByRole('button', { name: 'Add subpage' })[0])
    // The editor's parent select defaults to the chosen parent.
    const select = await screen.findByLabelText('Parent page')
    expect(select.value).toBe('parent')
  })

  it('reorders siblings via drag-and-drop, persisting a new order', async () => {
    const a = { ...page, id: 'a', title: 'Alpha', slug: 'alpha', sort_order: 0 }
    const b = { ...page, id: 'b', title: 'Beta', slug: 'beta', sort_order: 1 }
    campaigns.listWikiPages.mockResolvedValue([a, b])
    campaigns.getWikiPage.mockResolvedValue(a)
    renderView()
    await screen.findByText('Alpha')

    // Drag Beta and drop it above Alpha (top third → "before").
    // "Alpha" also appears as the main-pane heading; the sidebar rows are the
    // <button> elements inside a draggable wrapper.
    const rowFor = (title) =>
      screen
        .getAllByText(title)
        .map((el) => el.closest('div[draggable]'))
        .find(Boolean)
    const betaRow = rowFor('Beta')
    const alphaRow = rowFor('Alpha')
    fireEvent.dragStart(betaRow)
    alphaRow.getBoundingClientRect = () => ({ top: 0, height: 30 })
    fireDragAt('dragOver', alphaRow, 2)
    fireDragAt('drop', alphaRow, 2)

    await waitFor(() => expect(campaigns.reorderWikiPages).toHaveBeenCalledWith('c1', ['b', 'a']))
  })

  it('nests a page when dropped on the middle of another row', async () => {
    const a = { ...page, id: 'a', title: 'Alpha', slug: 'alpha', sort_order: 0 }
    const b = { ...page, id: 'b', title: 'Beta', slug: 'beta', sort_order: 1 }
    campaigns.listWikiPages.mockResolvedValue([a, b])
    campaigns.getWikiPage.mockResolvedValue(a)
    renderView()
    await screen.findByText('Alpha')

    // "Alpha" also appears as the main-pane heading; the sidebar rows are the
    // <button> elements inside a draggable wrapper.
    const rowFor = (title) =>
      screen
        .getAllByText(title)
        .map((el) => el.closest('div[draggable]'))
        .find(Boolean)
    const betaRow = rowFor('Beta')
    const alphaRow = rowFor('Alpha')
    fireEvent.dragStart(betaRow)
    alphaRow.getBoundingClientRect = () => ({ top: 0, height: 30 })
    fireDragAt('dragOver', alphaRow, 15)
    fireDragAt('drop', alphaRow, 15)

    await waitFor(() =>
      expect(campaigns.updateWikiPage).toHaveBeenCalledWith('c1', 'b', { parent_id: 'a' })
    )
  })
})

describe('WikiView markdown formatting toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.listWikiPages.mockResolvedValue([page])
    campaigns.getWikiPage.mockResolvedValue(page)
    campaigns.updateWikiPage.mockResolvedValue(page)
  })

  it('wraps the selection in bold markers when the Bold button is clicked', async () => {
    renderView()
    await screen.findByText('Here be dragons')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const textarea = await screen.findByLabelText('Markdown')
    textarea.setSelectionRange(8, 15) // "dragons"
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(textarea.value).toBe('Here be **dragons**')
  })

  it('prefixes the current line for the Bullet list button', async () => {
    renderView()
    await screen.findByText('Here be dragons')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const textarea = await screen.findByLabelText('Markdown')
    textarea.setSelectionRange(0, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Bullet list' }))
    expect(textarea.value).toBe('- Here be dragons')
  })
})

describe('WikiView audio "play all"', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    playQueue.mockClear()
  })

  const pageWithAudio = {
    ...page,
    body: 'Intro [[audio:a1]] middle [[audio:a2|Custom]] end',
  }

  it('shows a Play all button when the note embeds audio and queues them in order', async () => {
    campaigns.listWikiPages.mockResolvedValue([pageWithAudio])
    campaigns.getWikiPage.mockResolvedValue(pageWithAudio)
    renderView()
    const playAll = await screen.findByRole('button', { name: /play all/i })
    fireEvent.click(playAll)
    expect(playQueue).toHaveBeenCalledTimes(1)
    expect(playQueue.mock.calls[0][0].map((t) => t.id)).toEqual(['a1', 'a2'])
  })

  it('does not show a Play all button when the note has no audio embeds', async () => {
    campaigns.listWikiPages.mockResolvedValue([page])
    campaigns.getWikiPage.mockResolvedValue(page)
    renderView()
    await waitFor(() => screen.getByText('Dragons'))
    expect(screen.queryByTitle(/play all/i)).not.toBeInTheDocument()
  })

  it('shows Play all to a non-editor viewer when the note has audio', async () => {
    campaigns.listWikiPages.mockResolvedValue([pageWithAudio])
    campaigns.getWikiPage.mockResolvedValue({ ...pageWithAudio, can_edit: false })
    renderView({ isOwner: false })
    expect(await screen.findByRole('button', { name: /play all/i })).toBeInTheDocument()
  })
})

describe('WikiView create / delete / search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.listWikiPages.mockResolvedValue([page])
    campaigns.getWikiPage.mockResolvedValue(page)
    campaigns.updateWikiPage.mockResolvedValue(page)
    campaigns.deleteWikiPage.mockResolvedValue({})
  })

  it('opens the page editor when New Page is clicked', async () => {
    renderView()
    await screen.findByText('Here be dragons')
    fireEvent.click(screen.getByRole('button', { name: /new page/i }))
    // The editor exposes a Markdown textarea.
    expect(await screen.findByLabelText('Markdown')).toBeInTheDocument()
  })

  it('deletes the open page after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderView()
    await screen.findByText('Here be dragons')
    // The page header has a delete (trash) button.
    const buttons = screen.getAllByRole('button')
    const del = buttons.find((b) => b.querySelector('svg') && b.textContent === '')
    // Fall back: click the trash button near the Edit button.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    // Re-open view, then delete.
    await screen.findByText('Here be dragons')
    const trash = screen.getAllByRole('button').find((b) => b.style.color === 'var(--danger)')
    fireEvent.click(trash)
    await waitFor(() => expect(campaigns.deleteWikiPage).toHaveBeenCalledWith('c1', 'p1'))
    window.confirm.mockRestore()
  })

  it('filters the page list by the search query', async () => {
    campaigns.listWikiPages.mockResolvedValue([
      { ...page, id: 'p1', title: 'Dragons', slug: 'dragons' },
      { ...page, id: 'p2', title: 'Kobolds', slug: 'kobolds' },
    ])
    renderView()
    await screen.findByText('Kobolds')
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'kobold' } })
    // The non-matching sidebar entry is filtered out; Kobolds remains.
    expect(screen.getByText('Kobolds')).toBeInTheDocument()
    // "Dragons" remains only as the open page's title heading, not a list row.
    const dragonNodes = screen.getAllByText('Dragons')
    expect(dragonNodes.every((n) => n.tagName === 'H2')).toBe(true)
  })

  it('navigates to a page by clicking its sidebar entry', async () => {
    campaigns.listWikiPages.mockResolvedValue([
      { ...page, id: 'p1', title: 'Dragons', slug: 'dragons' },
      { ...page, id: 'p2', title: 'Kobolds', slug: 'kobolds' },
    ])
    campaigns.getWikiPage.mockImplementation((_c, id) =>
      Promise.resolve({ ...page, id, title: id === 'p2' ? 'Kobolds' : 'Dragons' })
    )
    renderView()
    await screen.findByText('Kobolds')
    campaigns.getWikiPage.mockClear()
    fireEvent.click(screen.getByText('Kobolds'))
    await waitFor(() => expect(campaigns.getWikiPage).toHaveBeenCalledWith('c1', 'p2'))
  })
})

describe('WikiView tree row chrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.updateWikiPage.mockResolvedValue(page)
  })

  const renderRow = async (over = {}) => {
    const row = { ...page, ...over }
    campaigns.listWikiPages.mockResolvedValue([row])
    campaigns.getWikiPage.mockResolvedValue(row)
    renderView()
    return await screen.findByText(row.title)
  }

  // The plus button is hover-only so a long page list stays uncluttered. It
  // stays mounted (opacity 0) rather than unmounting, so rows don't reflow.
  it('reveals the add-subpage button only while the row is hovered', async () => {
    const title = await renderRow()
    const rowEl = title.closest('div')
    const plus = screen.getByRole('button', { name: 'Add subpage' })
    expect(plus.style.opacity).toBe('0')

    fireEvent.mouseEnter(rowEl)
    expect(screen.getByRole('button', { name: 'Add subpage' }).style.opacity).toBe('1')

    fireEvent.mouseLeave(rowEl)
    expect(screen.getByRole('button', { name: 'Add subpage' }).style.opacity).toBe('0')
  })

  it('keeps the add-subpage button reachable by keyboard', async () => {
    const title = await renderRow()
    const plus = screen.getByRole('button', { name: 'Add subpage' })
    fireEvent.focus(plus)
    expect(screen.getByRole('button', { name: 'Add subpage' }).style.opacity).toBe('1')
    expect(title).toBeInTheDocument()
  })

  // Restricted pages read dimmer than public ones, so limited access is legible
  // without relying on the icon's colour.
  it('dims the title of a restricted page relative to a public one', async () => {
    campaigns.listWikiPages.mockResolvedValue([
      { ...page, id: 'pub', title: 'Public page', visibility: 'group' },
      { ...page, id: 'sec', title: 'Secret page', visibility: 'gm' },
    ])
    campaigns.getWikiPage.mockResolvedValue({ ...page, id: 'pub', visibility: 'group' })
    renderView()

    const publicTitle = await screen.findByText('Public page')
    const secretTitle = screen.getByText('Secret page')
    const opacityOf = (el) => Number(el.style.opacity || '1')
    expect(opacityOf(secretTitle)).toBeLessThan(1)
    // The selected row keeps full contrast, so compare against an unselected one.
    expect(opacityOf(secretTitle)).toBeLessThan(opacityOf(publicTitle))
  })

  it('tints a read-only row icon with the stored colour', async () => {
    await renderRow({
      icon: 'castle',
      icon_color: 'red',
      can_edit: false,
      visibility: 'gm',
    })
    const tinted = [...document.querySelectorAll('svg')].some(
      (el) => el.style.color === 'rgb(224, 82, 82)' // preset "red"
    )
    expect(tinted).toBe(true)
  })

  it('changes visibility from the row glyph', async () => {
    const title = await renderRow({ visibility: 'gm' })
    const rowEl = title.closest('div')
    fireEvent.mouseEnter(rowEl)
    const glyph = screen.getByRole('button', { name: /change visibility \(currently/i })
    fireEvent.click(glyph)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /public/i }))
    await waitFor(() =>
      expect(campaigns.updateWikiPage).toHaveBeenCalledWith('c1', 'p1', {
        visibility: 'group',
        shared_user_ids: [],
      })
    )
  })
})

// Export lets a player take their own copy of the campaign with them, so it is
// not owner-gated. Import writes pages, so it stays owner-only and disappears
// once the campaign is archived.
describe('WikiView export and import affordances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.listWikiPages.mockResolvedValue([page])
    campaigns.exportWiki.mockResolvedValue({})
  })

  it('offers export to a non-owner member', async () => {
    renderView({ isOwner: false })
    await waitFor(() => expect(screen.getByText('Dragons')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^export$/i })).toBeInTheDocument()
  })

  it('exports as markdown when a member clicks export', async () => {
    renderView({ isOwner: false })
    await waitFor(() => screen.getByText('Dragons'))
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }))
    await waitFor(() => expect(campaigns.exportWiki).toHaveBeenCalledWith('c1', 'md'))
  })

  it('hides import from a non-owner', async () => {
    renderView({ isOwner: false })
    await waitFor(() => screen.getByText('Dragons'))
    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument()
  })

  it('offers import to the owner of an active campaign', async () => {
    renderView()
    await waitFor(() => screen.getByText('Dragons'))
    expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument()
  })

  it('keeps export but drops import once the campaign is archived', async () => {
    renderView({ campaign: { ...campaign, is_archived: true } })
    await waitFor(() => screen.getByText('Dragons'))
    expect(screen.getByRole('button', { name: /^export$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument()
  })
})
