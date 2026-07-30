import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagPicker from './TagPicker'

const mockList = vi.fn()
vi.mock('../../api', () => ({
  tags: { list: (...a) => mockList(...a) },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockList.mockResolvedValue({
    tags: [
      { internal: 'dinosaur', display: 'Dinosaur', category: 'map', is_favorite: true },
      { internal: 'building', display: 'Building', category: 'map', is_favorite: false },
      { internal: 'dungeon', display: 'Dungeon', category: 'map', is_favorite: false },
      { internal: 'lore', display: 'Lore', category: 'book', is_favorite: false },
      { internal: 'strahd', display: 'Strahd', category: 'shared', is_favorite: false },
    ],
  })
})

function Harness({ initial = [], resourceType = null }) {
  const [value, setValue] = useState(initial)
  return <TagPicker value={value} onChange={setValue} resourceType={resourceType} />
}

describe('TagPicker', () => {
  it('renders selected tags as chips', () => {
    render(<Harness initial={['forest', 'cave']} />)
    expect(screen.getByText('forest')).toBeInTheDocument()
    expect(screen.getByText('cave')).toBeInTheDocument()
  })

  it('fetches the full (unscoped) catalog so every tag category is known', async () => {
    render(<Harness resourceType="map" />)
    await waitFor(() => expect(mockList).toHaveBeenCalledWith())
  })

  it('shows only favorited tags on focus with an empty input', async () => {
    render(<Harness />)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    fireEvent.focus(screen.getByRole('combobox'))
    // Dinosaur is the only favorite → shown; non-favorites hidden until typing.
    expect(await screen.findByRole('option', { name: /Dinosaur/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Building/ })).not.toBeInTheDocument()
  })

  it('ranks a favorite prefix match first', async () => {
    render(<Harness />)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    // "din" prefix-matches the favorite Dinosaur; it should be first (debounced).
    await userEvent.type(screen.getByRole('combobox'), 'din')
    await screen.findByRole('option', { name: /Dinosaur/ })
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options[0]).toContain('Dinosaur')
  })

  it('groups this category + shared separately from other-category tags', async () => {
    render(<Harness resourceType="book" />)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    // "d" matches Strahd (shared) → category group; Dinosaur (fav);
    // Building/Dungeon (map) → other-category group.
    await userEvent.type(screen.getByRole('combobox'), 'd')
    expect(await screen.findByText(/this category & shared/i)).toBeInTheDocument()
    expect(screen.getByText(/all other tags/i)).toBeInTheDocument()
    // Shared tag is offered in the category group.
    expect(screen.getByRole('option', { name: /Strahd/ })).toBeInTheDocument()
    // Map tags fall into the other-category group.
    expect(screen.getByRole('option', { name: /Building/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Dungeon/ })).toBeInTheDocument()
  })

  it('adds a chosen existing tag with its display casing', async () => {
    render(<Harness />)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    await userEvent.type(screen.getByRole('combobox'), 'dun')
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Dungeon/ }))
    expect(screen.getByText('Dungeon')).toBeInTheDocument()
  })

  it('offers a create row and adds a new tag on Enter', async () => {
    render(<Harness />)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    await userEvent.type(screen.getByRole('combobox'), 'Brand New')
    // Wait for the debounced create row, then commit.
    await screen.findByRole('option', { name: /Create/i })
    await userEvent.type(screen.getByRole('combobox'), '{Enter}')
    expect(screen.getByText('Brand New')).toBeInTheDocument()
  })

  it('does not remove tags on Backspace (tags are removed via their ✕ button)', async () => {
    render(<Harness initial={['a', 'b']} />)
    const input = screen.getByRole('combobox')
    input.focus()
    fireEvent.keyDown(input, { key: 'Backspace' })
    // Both chips remain — Backspace only edits the input text.
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })

  it('does not suggest an already-selected tag', async () => {
    render(<Harness initial={['dungeon']} />)
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    await userEvent.type(screen.getByRole('combobox'), 'dun')
    // Give the debounce time to settle, then confirm Dungeon is not offered.
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Dungeon/ })).not.toBeInTheDocument()
    )
  })
})
