import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BookSystemLinksSection from './BookSystemLinksSection'

const mockGet: Mock = vi.fn()
const mockList: Mock = vi.fn()
const mockAdd: Mock = vi.fn()
const mockRemove: Mock = vi.fn()

vi.mock('../../api', () => ({
  default: { get: (...a: unknown[]) => mockGet(...a) },
  bookLinks: {
    list: (...a: unknown[]) => mockList(...a),
    add: (...a: unknown[]) => mockAdd(...a),
    remove: (...a: unknown[]) => mockRemove(...a),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { name?: string }) => (o?.name ? `${k}:${o.name}` : k),
  }),
}))

const midgard = { id: 's-pf', name: 'Pathfinder', game_type: 'ttrpg', is_one_page: false }
const systems = [
  { id: 's-home', name: 'D&D 5e' },
  { id: 's-pf', name: 'Pathfinder' },
  { id: 's-osr', name: 'Shadowdark' },
  { id: 's-ag', name: 'Age of Sigmar' },
]

const book = { id: 'b1', game_system_id: 's-home', game_type: 'ttrpg' }

const renderSection = (onChanged?: (links: unknown[]) => void) =>
  render(
    <MemoryRouter>
      <BookSystemLinksSection book={book} onChanged={onChanged} />
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockResolvedValue(systems)
})

describe('BookSystemLinksSection', () => {
  it('lists the systems the book is linked to, as links to their shelves', async () => {
    mockList.mockResolvedValue([midgard])
    renderSection()
    const link = await screen.findByRole('link', { name: 'Pathfinder' })
    expect(link.getAttribute('href')).toBe('/library/system/s-pf')
    expect(mockList).toHaveBeenCalledWith('b1')
  })

  it('says so when the book is only on its own shelf', async () => {
    mockList.mockResolvedValue([])
    renderSection()
    expect(await screen.findByText('bookLinks.none')).toBeTruthy()
  })

  it('treats a failed load as no links', async () => {
    mockList.mockRejectedValue(new Error('nope'))
    renderSection()
    expect(await screen.findByText('bookLinks.none')).toBeTruthy()
  })

  it('offers every other system of the same kind, and adds a link', async () => {
    mockList.mockResolvedValue([midgard])
    const linked = [midgard, { id: 's-osr', name: 'Shadowdark', game_type: 'ttrpg' }]
    mockAdd.mockResolvedValue(linked)
    const onChanged = vi.fn()
    renderSection(onChanged)
    await userEvent.click(await screen.findByRole('button', { name: 'bookLinks.add' }))
    const select = await screen.findByRole('combobox', { name: 'bookLinks.pick' })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Shadowdark' })).toBeTruthy())
    expect(mockGet).toHaveBeenCalledWith('/systems?include_children=true&game_type=ttrpg')
    // Its own system and the ones it is already on are not offered.
    const offered = screen.getAllByRole('option').map((o) => o.textContent)
    expect(offered).toEqual(['bookLinks.pick', 'Age of Sigmar', 'Shadowdark'])

    await userEvent.selectOptions(select, 's-osr')
    await userEvent.click(screen.getByRole('button', { name: 'bookLinks.addButton' }))
    expect(mockAdd).toHaveBeenCalledWith('b1', 's-osr')
    expect(await screen.findByRole('link', { name: 'Shadowdark' })).toBeTruthy()
    expect(onChanged).toHaveBeenCalledWith(linked)
    // The picker closes once the link is made.
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows the server’s refusal and keeps the picker open', async () => {
    mockList.mockResolvedValue([])
    mockAdd.mockRejectedValue({ message: 'A role-playing book can only be linked…' })
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'bookLinks.add' }))
    const select = await screen.findByRole('combobox', { name: 'bookLinks.pick' })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Pathfinder' })).toBeTruthy())
    await userEvent.selectOptions(select, 's-pf')
    await userEvent.click(screen.getByRole('button', { name: 'bookLinks.addButton' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'A role-playing book can only be linked…'
    )
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('falls back to a generic error, and cancels the picker', async () => {
    mockList.mockResolvedValue([])
    mockAdd.mockRejectedValue(null)
    mockGet.mockRejectedValue(new Error('down'))
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'bookLinks.add' }))
    await waitFor(() =>
      expect(
        (screen.getByRole('combobox', { name: 'bookLinks.pick' }) as HTMLSelectElement).disabled
      ).toBe(false)
    )
    // With no systems loaded there is nothing to pick, so Add stays disabled.
    expect(
      (screen.getByRole('button', { name: 'bookLinks.addButton' }) as HTMLButtonElement).disabled
    ).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('button', { name: 'bookLinks.add' })).toBeTruthy()
  })

  it('removes a link', async () => {
    mockList.mockResolvedValue([midgard])
    mockRemove.mockResolvedValue([])
    renderSection()
    await userEvent.click(
      await screen.findByRole('button', { name: 'bookLinks.remove:Pathfinder' })
    )
    expect(mockRemove).toHaveBeenCalledWith('b1', 's-pf')
    expect(await screen.findByText('bookLinks.none')).toBeTruthy()
  })

  it('reports a failed removal', async () => {
    mockList.mockResolvedValue([midgard])
    mockRemove.mockRejectedValue(null)
    renderSection()
    await userEvent.click(
      await screen.findByRole('button', { name: 'bookLinks.remove:Pathfinder' })
    )
    expect((await screen.findByRole('alert')).textContent).toBe('common.error')
    expect(screen.getByRole('link', { name: 'Pathfinder' })).toBeTruthy()
  })
})
