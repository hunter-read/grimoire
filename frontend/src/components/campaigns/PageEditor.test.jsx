import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PageEditor from './PageEditor'

vi.mock('../../api', () => ({
  campaigns: {
    createWikiPage: vi.fn(),
    updateWikiPage: vi.fn(),
    wikiTitles: vi.fn(),
  },
}))
vi.mock('./WikiMarkdown', () => ({
  default: ({ body }) => <div data-testid="preview">{body}</div>,
}))
vi.mock('./GrimoireEmbedPicker', () => ({
  default: ({ onInsert }) => (
    <button onClick={() => onInsert('[[book:1]]')}>insert-embed-stub</button>
  ),
}))

import { campaigns } from '../../api'

const campaign = {
  id: 'c1',
  name: 'Test',
  members: [
    { user_id: 'u1', is_owner: true, username: 'gm' },
    { user_id: 'u2', is_owner: false, username: 'alice' },
  ],
}

const existing = {
  id: 'p1',
  title: 'Dragons',
  body: 'Here be dragons',
  visibility: 'gm',
  parent_id: null,
  icon: 'castle',
  icon_color: 'red',
  shared_user_ids: [],
}

// Payload shape of GET /campaigns/:id/wiki/titles.
const LINK_TARGETS = [
  {
    id: 'p1',
    title: 'Boblin the Goblin',
    slug: 'boblin-the-goblin',
    ambiguous: false,
    headings: [{ text: 'Loot', level: 2 }],
  },
  { id: 'p2', title: 'Castle Ruins', slug: 'castle-ruins', ambiguous: false, headings: [] },
  { id: 'p3', title: 'Ancient Ruins', slug: 'ancient-ruins', ambiguous: true, headings: [] },
  { id: 'p4', title: 'ancient ruins', slug: 'ancient-ruins-2', ambiguous: true, headings: [] },
]

const renderEditor = (props = {}) =>
  render(
    <PageEditor
      campaign={campaign}
      isOwner
      page={null}
      allPages={[]}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />
  )

beforeEach(() => {
  vi.clearAllMocks()
  campaigns.createWikiPage.mockResolvedValue({ id: 'new' })
  campaigns.updateWikiPage.mockResolvedValue({ id: 'p1' })
  campaigns.wikiTitles.mockResolvedValue(LINK_TARGETS)
})

describe('PageEditor', () => {
  it('creates a new page with the entered title and body', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    renderEditor({ onSaved })

    await user.type(screen.getByLabelText('Page title'), 'The Tavern')
    await user.type(screen.getByLabelText('Markdown'), 'A cozy inn.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(campaigns.createWikiPage).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ title: 'The Tavern', body: 'A cozy inn.' })
      )
    )
    expect(onSaved).toHaveBeenCalledWith({ id: 'new' })
  })

  it('falls back to "Untitled" when the title is blank', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(campaigns.createWikiPage).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ title: 'Untitled' })
      )
    )
  })

  it('updates an existing page and preserves its icon and tint', async () => {
    const user = userEvent.setup()
    renderEditor({ page: existing, allPages: [existing] })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(campaigns.updateWikiPage).toHaveBeenCalledWith(
        'c1',
        'p1',
        expect.objectContaining({ icon: 'castle', icon_color: 'red' })
      )
    )
  })

  it('saves an icon and colour chosen from the picker', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'Icon' }))
    const dialog = screen.getByRole('dialog', { name: 'Icon' })
    // The popover stays open after picking an icon, so the colour is one more
    // click away rather than requiring a reopen.
    await user.click(within(dialog).getByRole('button', { name: 'swords' }))
    await user.click(within(dialog).getByRole('button', { name: 'Purple' }))

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(campaigns.createWikiPage).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ icon: 'swords', icon_color: 'purple' })
      )
    )
  })

  it('sends the share list only for members visibility', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.selectOptions(screen.getByLabelText('Visibility'), 'members')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(campaigns.createWikiPage).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ visibility: 'members', shared_user_ids: ['u2'] })
      )
    )
  })

  it('clears the share list when visibility moves away from members', async () => {
    const user = userEvent.setup()
    renderEditor({ page: { ...existing, visibility: 'members', shared_user_ids: ['u2'] } })
    await user.selectOptions(screen.getByLabelText('Visibility'), 'group')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(campaigns.updateWikiPage).toHaveBeenCalledWith(
        'c1',
        'p1',
        expect.objectContaining({ visibility: 'group', shared_user_ids: [] })
      )
    )
  })

  it('limits a non-owner to the public visibility level', () => {
    renderEditor({ isOwner: false })
    const select = screen.getByLabelText('Visibility')
    expect(select).toBeDisabled()
    expect(within(select).getAllByRole('option')).toHaveLength(1)
  })

  it('excludes the page and its descendants from the parent options', () => {
    const child = { id: 'child', title: 'Child', parent_id: 'p1', slug: 'child' }
    const other = { id: 'other', title: 'Other', parent_id: null, slug: 'other' }
    renderEditor({ page: existing, allPages: [existing, child, other] })
    const options = within(screen.getByLabelText('Parent page'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options).toContain('Other')
    expect(options).not.toContain('Dragons')
    expect(options).not.toContain('Child')
  })

  it('wraps the selection with the bold button', async () => {
    const user = userEvent.setup()
    renderEditor()
    const body = screen.getByLabelText('Markdown')
    await user.type(body, 'word')
    body.setSelectionRange(0, 4)
    await user.click(screen.getByRole('button', { name: 'Bold' }))
    expect(body).toHaveValue('**word**')
  })

  it('prefixes lines with the quote button, and toggles them back off', async () => {
    const user = userEvent.setup()
    renderEditor()
    const body = screen.getByLabelText('Markdown')
    await user.type(body, 'line')
    await user.click(screen.getByRole('button', { name: 'Quote' }))
    expect(body).toHaveValue('> line')
    await user.click(screen.getByRole('button', { name: 'Quote' }))
    expect(body).toHaveValue('line')
  })

  it('toggles the live preview pane', async () => {
    const user = userEvent.setup()
    renderEditor()
    expect(screen.queryByTestId('preview')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByTestId('preview')).toBeInTheDocument()
  })

  it('inserts an embed token from the picker', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: /embed/i }))
    await user.click(screen.getByRole('button', { name: 'insert-embed-stub' }))
    expect(screen.getByLabelText('Markdown')).toHaveValue('[[book:1]]')
  })

  it('surfaces a save error and stays open', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    campaigns.createWikiPage.mockRejectedValue(new Error('Server exploded'))
    renderEditor({ onSaved })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Server exploded')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('cancels without saving', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderEditor({ onCancel })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(campaigns.createWikiPage).not.toHaveBeenCalled()
  })
})

describe('PageEditor [[link]] autocomplete', () => {
  // Type into the body textarea. userEvent reads "[" as the start of its
  // special-key syntax, so brackets are doubled to type them literally.
  const typeBody = async (user, text) => {
    const body = screen.getByLabelText('Markdown')
    await user.click(body)
    await user.type(body, text.replace(/\[/g, '[['))
    return body
  }

  // The suggestion dropdown, or null when it isn't showing. Scoped to the
  // listbox because the visibility/parent <select>s also expose role="option".
  const listbox = () => screen.queryByRole('listbox', { name: 'Page suggestions' })
  const options = () => (listbox() ? within(listbox()).getAllByRole('option') : [])
  const findOption = async (name) =>
    within(await screen.findByRole('listbox', { name: 'Page suggestions' })).findByRole('option', {
      name,
    })

  it('suggests pages once [[ is typed', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalledWith('c1'))
    await typeBody(user, 'see [[Bob')
    expect(await findOption('Boblin the Goblin')).toBeTruthy()
  })

  it('matches a word in the middle of a title', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    await typeBody(user, '[[gob')
    expect(await findOption('Boblin the Goblin')).toBeTruthy()
  })

  it('inserts the completed link on click', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    const body = await typeBody(user, 'see [[Bob')
    await user.click(await findOption('Boblin the Goblin'))
    expect(body.value).toBe('see [[Boblin the Goblin]]')
  })

  it('reuses an existing "]]" instead of doubling it', async () => {
    // The Link page button inserts an empty "[[]]" pair and puts the caret
    // between the brackets; completing there must not leave "]]]]".
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    const body = screen.getByLabelText('Markdown')
    await user.click(screen.getByRole('button', { name: /Link page/ }))
    await user.keyboard('Bob')
    await user.click(await findOption('Boblin the Goblin'))
    expect(body.value).toBe('[[Boblin the Goblin]]')
  })

  it('keeps trailing text after a reused "]]" intact', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    const body = await typeBody(user, 'see [[Bob]] here')
    // Put the caret back inside the still-open link, before its "]]".
    body.setSelectionRange(9, 9)
    await user.keyboard('l')
    await user.click(await findOption('Boblin the Goblin'))
    expect(body.value).toBe('see [[Boblin the Goblin]] here')
  })

  it('still adds "]]" when the link is unclosed', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    const body = await typeBody(user, 'see [[Bob and more')
    body.setSelectionRange(9, 9)
    await user.keyboard('l')
    await user.click(await findOption('Boblin the Goblin'))
    expect(body.value).toBe('see [[Boblin the Goblin]] and more')
  })

  it('inserts a heading link when a heading row is chosen', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    const body = await typeBody(user, '[[Loot')
    await user.click(await findOption(/Loot/))
    expect(body.value).toBe('[[Boblin the Goblin:#Loot]]')
  })

  it('adds the :id- disambiguator only for an ambiguous title', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    const body = await typeBody(user, '[[Ancient')
    await user.click(await findOption('Ancient Ruins'))
    expect(body.value).toBe('[[Ancient Ruins:id-p3]]')
  })

  it('accepts the highlighted match on Enter', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    const body = await typeBody(user, '[[Castle')
    await findOption(/Castle Ruins/)
    await user.keyboard('{Enter}')
    expect(body.value).toBe('[[Castle Ruins]]')
  })

  it('moves the highlight with the arrow keys', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    const body = await typeBody(user, '[[Boblin')
    await findOption('Boblin the Goblin')
    // Two rows: the page itself and its "Loot" heading.
    await user.keyboard('{ArrowDown}{Enter}')
    expect(body.value).toBe('[[Boblin the Goblin:#Loot]]')
  })

  it('dismisses the dropdown on Escape', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    await typeBody(user, '[[Bob')
    await findOption('Boblin the Goblin')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(listbox()).toBeNull())
  })

  it('closes the dropdown once the link is closed', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    await typeBody(user, '[[Bob]]')
    await waitFor(() => expect(listbox()).toBeNull())
  })

  it('shows no dropdown outside a [[ link', async () => {
    const user = userEvent.setup()
    renderEditor()
    await waitFor(() => expect(campaigns.wikiTitles).toHaveBeenCalled())
    await typeBody(user, 'just prose')
    expect(listbox()).toBeNull()
  })

  it('stays usable when the titles lookup fails', async () => {
    campaigns.wikiTitles.mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    renderEditor()
    const body = await typeBody(user, '[[Bob')
    expect(body.value).toBe('[[Bob')
    expect(options()).toEqual([])
  })
})

// Issue #293: the editor should fill the viewport, scroll the editing surface
// internally, and keep Save/Cancel reachable without scrolling.
describe('PageEditor viewport fill', () => {
  it('sizes its root to the remaining viewport height', () => {
    const { container } = renderEditor()
    // jsdom reports a 0 top and a 768px viewport, leaving 744 after the gap.
    expect(container.firstChild.style.height).toBe('744px')
  })

  it('lets the editor row take the leftover space while the buttons stay fixed', () => {
    const { container } = renderEditor()
    const rows = Array.from(container.firstChild.children)
    // The markdown/preview row is the only one allowed to grow.
    const growing = rows.filter((r) => r.style.flex === '1 1 auto')
    expect(growing).toHaveLength(1)
    // Every other row is pinned, so Save/Cancel can't be pushed off-screen.
    const saveRow = rows[rows.length - 1]
    expect(saveRow).toHaveTextContent('Save')
    expect(saveRow.style.flexShrink).toBe('0')
  })

  it('makes the textarea flex and scroll instead of resize', () => {
    renderEditor()
    const body = screen.getByRole('textbox', { name: 'Markdown' })
    expect(body.style.flex).toBe('1 1 auto')
    expect(body.style.resize).toBe('none')
  })

  it('scrolls the preview pane internally', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: /preview/i }))
    const pane = screen.getByTestId('preview').parentElement
    expect(pane.style.overflowY).toBe('auto')
  })

  it('falls back to natural flow when the viewport is too short', () => {
    const original = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { value: 200, configurable: true })
    try {
      const { container } = renderEditor()
      expect(container.firstChild.style.height).toBe('')
      const body = screen.getByRole('textbox', { name: 'Markdown' })
      expect(body.style.resize).toBe('vertical')
    } finally {
      Object.defineProperty(window, 'innerHeight', { value: original, configurable: true })
    }
  })

  it('keeps the natural page flow on mobile', () => {
    const original = window.matchMedia
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    try {
      const { container } = renderEditor()
      expect(container.firstChild.style.height).toBe('')
    } finally {
      window.matchMedia = original
    }
  })
})
