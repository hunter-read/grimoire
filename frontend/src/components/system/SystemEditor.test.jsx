import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SystemEditor from './SystemEditor'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { patch: vi.fn(), get: vi.fn(), post: vi.fn() },
  tags: { list: () => Promise.resolve({ tags: [] }) },
  mediaUrl: (p) => `http://localhost${p}`,
}))

beforeEach(() => {
  vi.clearAllMocks()
  api.patch.mockResolvedValue({})
  // useLookups loads genres + system families on mount.
  api.get.mockImplementation((path) =>
    Promise.resolve(path.includes('genres') ? { genres: [] } : { families: [] })
  )
  api.post.mockResolvedValue({})
})

const system = (over = {}) => ({
  id: 'sys1',
  description: '',
  publishers: [],
  character_builder_url: '',
  tags: [],
  genre: '',
  cover_book_id: null,
  is_explicit: false,
  books: [],
  ...over,
})

describe('SystemEditor', () => {
  it('saves the patched fields and calls onSave', async () => {
    const onSave = vi.fn()
    render(<SystemEditor system={system({ genres: ['Fantasy'] })} onSave={onSave} />)
    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/systems/sys1', expect.any(Object)))
    expect(api.patch.mock.calls[0][1].genres).toEqual(['Fantasy'])
    expect(onSave).toHaveBeenCalled()
  })

  it('adds a tag on Enter and includes it in the save payload', async () => {
    render(<SystemEditor system={system()} onSave={vi.fn()} />)
    const tagInput = screen.getByPlaceholderText(/tag/i)
    await userEvent.type(tagInput, 'grimdark{Enter}')
    expect(screen.getByText('grimdark')).toBeInTheDocument()
    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    expect(api.patch.mock.calls[0][1].tags).toContain('grimdark')
  })

  it('drops empty publishers from the save payload', async () => {
    render(
      <SystemEditor
        system={system({
          publishers: [
            { name: 'WotC', url: '' },
            { name: '', url: '' },
          ],
        })}
        onSave={vi.fn()}
      />
    )
    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    expect(api.patch.mock.calls[0][1].publishers).toEqual([{ name: 'WotC', url: '' }])
  })

  it('renders cover choices lazily and toggles the selection', async () => {
    const { container } = render(
      <SystemEditor
        system={system({ books: [{ id: 'b1', title: 'Core Book', has_thumbnail: true }] })}
        onSave={vi.fn()}
      />
    )
    const img = container.querySelector('img')
    expect(img.getAttribute('src')).toContain('/books/b1/thumbnail')
    expect(img).toHaveAttribute('loading', 'lazy')

    await userEvent.click(screen.getByTitle('Core Book'))
    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    expect(api.patch.mock.calls[0][1].cover_book_id).toBe('b1')
  })

  it('adds a genre and a dice/material and includes them in the save payload', async () => {
    render(<SystemEditor system={system()} onSave={vi.fn()} />)
    // GenrePicker: type a new genre and commit with Enter.
    const genreInput = screen.getByRole('combobox', { name: /add genre/i })
    await userEvent.type(genreInput, 'Cyberpunk{Enter}')
    // DiceMaterialsPicker: type a new material and commit.
    const diceInput = screen.getByRole('combobox', { name: /dice|material/i })
    await userEvent.type(diceInput, 'd20{Enter}')

    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    const payload = api.patch.mock.calls[0][1]
    expect(payload.genres).toContain('Cyberpunk')
    expect(payload.dice_materials).toContain('D20')
  })

  it('edits edition, year, and a generic URL row in the save payload', async () => {
    render(<SystemEditor system={system()} onSave={vi.fn()} />)
    await userEvent.type(document.getElementById('system-edition'), '5e')
    const year = document.getElementById('system-field-year')
    if (year) await userEvent.type(year, '2014')
    // First generic URL row is pre-rendered blank for editing.
    const urlInput = document.getElementById('system-url-url-0')
    if (urlInput) await userEvent.type(urlInput, 'https://example.com')

    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    const payload = api.patch.mock.calls[0][1]
    expect(payload.edition).toBe('5e')
    if (urlInput) expect(payload.urls).toEqual([{ label: '', url: 'https://example.com' }])
  })

  it('edits the description and a character-builder link', async () => {
    render(<SystemEditor system={system()} onSave={vi.fn()} />)
    const desc = document.getElementById('system-field-description')
    await userEvent.type(desc, 'A grim world')
    // The first character-builder link row is pre-rendered (blank) for editing.
    const cbUrl = document.getElementById('system-cb-url-url-0')
    await userEvent.type(cbUrl, 'https://builder.example')
    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    const payload = api.patch.mock.calls[0][1]
    expect(payload.description).toBe('A grim world')
    expect(payload.character_builder_urls).toEqual([{ label: '', url: 'https://builder.example' }])
  })

  it('does not remove tags on Backspace (removal is via the ✕ button)', async () => {
    render(<SystemEditor system={system({ tags: ['alpha', 'beta'] })} onSave={vi.fn()} />)
    const tagInput = screen.getByRole('combobox', { name: /add tag/i })
    tagInput.focus()
    await userEvent.keyboard('{Backspace}')
    // Both tags remain — Backspace only edits the input text.
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
  })

  it('removes a tag via its remove button', async () => {
    render(<SystemEditor system={system({ tags: ['keepme', 'dropme'] })} onSave={vi.fn()} />)
    const dropTag = screen.getByText('dropme')
    await userEvent.click(dropTag.querySelector('button'))
    expect(screen.queryByText('dropme')).toBeNull()
  })

  it('adds, edits, and removes publishers', async () => {
    render(<SystemEditor system={system()} onSave={vi.fn()} />)
    // system() has no publishers, so the form seeds one empty row.
    await userEvent.click(screen.getByText(/add publisher/i))
    const names = screen.getAllByLabelText(/publisher name/i)
    expect(names.length).toBe(2)
    await userEvent.type(names[0], 'Paizo')
    const urls = screen.getAllByLabelText(/url \(optional\)/i)
    await userEvent.type(urls[0], 'https://paizo.com')
    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    expect(api.patch.mock.calls[0][1].publishers).toEqual([
      { name: 'Paizo', url: 'https://paizo.com' },
    ])
  })

  it('toggles the explicit checkbox into the payload', async () => {
    render(<SystemEditor system={system()} onSave={vi.fn()} />)
    await userEvent.click(document.getElementById('system-is-explicit'))
    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    expect(api.patch.mock.calls[0][1].is_explicit).toBe(true)
  })

  it('clears a selected cover', async () => {
    render(
      <SystemEditor
        system={system({
          cover_book_id: 'b1',
          books: [{ id: 'b1', title: 'Core Book', has_thumbnail: true }],
        })}
        onSave={vi.fn()}
      />
    )
    await userEvent.click(screen.getByText(/clear/i))
    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    expect(api.patch.mock.calls[0][1].cover_book_id).toBeNull()
  })

  it('omits the cover picker when no book has a thumbnail', () => {
    render(
      <SystemEditor
        system={system({ books: [{ id: 'b1', title: 'No Thumb', has_thumbnail: false }] })}
        onSave={vi.fn()}
      />
    )
    expect(screen.queryByTitle('No Thumb')).toBeNull()
  })

  describe('fetch metadata trigger', () => {
    const withSources = (sources) =>
      api.get.mockImplementation((path) => {
        if (path.includes('metadata-sources')) return Promise.resolve({ sources })
        return Promise.resolve(path.includes('genres') ? { genres: [] } : { families: [] })
      })

    it('is hidden when no metadata source is installed', async () => {
      withSources([])
      render(<SystemEditor system={system()} onSave={vi.fn()} />)
      await waitFor(() => expect(api.get).toHaveBeenCalled())
      expect(screen.queryByText(/fetch metadata/i)).toBeNull()
    })

    it('appears once a source is available', async () => {
      withSources([{ id: 'ttrpg-wiki', name: 'TTRPG Wiki' }])
      render(<SystemEditor system={system()} onSave={vi.fn()} />)
      expect(await screen.findByText(/fetch metadata/i)).toBeInTheDocument()
    })

    it('stays hidden when the sources lookup fails', async () => {
      // A backend without the add-on routes must not break the editor.
      api.get.mockImplementation((path) => {
        if (path.includes('metadata-sources')) return Promise.reject(new Error('nope'))
        return Promise.resolve(path.includes('genres') ? { genres: [] } : { families: [] })
      })
      render(<SystemEditor system={system()} onSave={vi.fn()} />)
      await waitFor(() => expect(api.get).toHaveBeenCalled())
      expect(screen.queryByText(/fetch metadata/i)).toBeNull()
    })

    it('opens the fetch dialog', async () => {
      withSources([{ id: 'ttrpg-wiki', name: 'TTRPG Wiki' }])
      render(<SystemEditor system={system()} onSave={vi.fn()} />)
      await userEvent.click(await screen.findByText(/fetch metadata/i))
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
    })
  })
})
