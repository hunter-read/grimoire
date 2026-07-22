import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SystemEditor from './SystemEditor'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { patch: vi.fn() },
  mediaUrl: (p) => `http://localhost${p}`,
}))

beforeEach(() => {
  vi.clearAllMocks()
  api.patch.mockResolvedValue({})
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
    render(<SystemEditor system={system({ genre: 'Fantasy' })} onSave={onSave} />)
    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/systems/sys1', expect.any(Object)))
    expect(api.patch.mock.calls[0][1].genre).toBe('Fantasy')
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

  it('edits the description and character-builder URL fields', async () => {
    render(<SystemEditor system={system()} onSave={vi.fn()} />)
    const desc = document.getElementById('system-field-description')
    await userEvent.type(desc, 'A grim world')
    const cb = document.getElementById('system-field-character_builder_url')
    await userEvent.type(cb, 'https://builder.example')
    await userEvent.click(screen.getByText(/save changes/i))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    const payload = api.patch.mock.calls[0][1]
    expect(payload.description).toBe('A grim world')
    expect(payload.character_builder_url).toBe('https://builder.example')
  })

  it('removes the last tag on Backspace in an empty input', async () => {
    render(<SystemEditor system={system({ tags: ['alpha', 'beta'] })} onSave={vi.fn()} />)
    const tagInput = document.getElementById('system-tag-input')
    tagInput.focus()
    await userEvent.keyboard('{Backspace}')
    expect(screen.queryByText('beta')).toBeNull()
    expect(screen.getByText('alpha')).toBeInTheDocument()
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
})
