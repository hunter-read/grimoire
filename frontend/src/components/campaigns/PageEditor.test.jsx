import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PageEditor from './PageEditor'

vi.mock('../../api', () => ({
  campaigns: {
    createWikiPage: vi.fn(),
    updateWikiPage: vi.fn(),
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
    await user.click(within(dialog).getByRole('button', { name: 'swords' }))

    await user.click(screen.getByRole('button', { name: 'Icon' }))
    const reopened = screen.getByRole('dialog', { name: 'Icon' })
    await user.click(within(reopened).getByRole('button', { name: 'Purple' }))

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
