import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ApiKeyDialog from './ApiKeyDialog'

const permissions = [
  { id: 'stats', group: 'library', description: 'server stats copy', levels: ['none', 'read'] },
  {
    id: 'books',
    group: 'library',
    description: 'server books copy',
    levels: ['none', 'read', 'write'],
  },
  { id: 'maps', group: 'media', description: 'server maps copy', levels: ['none', 'read'] },
  {
    id: 'future',
    group: 'mystery',
    description: 'A permission the UI has no copy for',
    levels: ['none', 'read'],
  },
]

// Groups start folded on a new key; open them all to reach every picker.
const openAll = () =>
  screen.queryAllByRole('button', { expanded: false }).forEach((header) => fireEvent.click(header))

describe('ApiKeyDialog', () => {
  it('shows a picker per permission with its description and levels', () => {
    render(
      <ApiKeyDialog apiKey={null} permissions={permissions} onSave={vi.fn()} onClose={vi.fn()} />
    )
    openAll()
    expect(screen.getByText('Create API key')).toBeInTheDocument()
    expect(
      screen.getByText('Library counts and totals (e.g. for dashboard widgets like Homepage)')
    ).toBeInTheDocument()
    const books = screen.getByLabelText('Books')
    expect([...books.options].map((o) => o.textContent)).toEqual([
      'No access',
      'Read',
      'Read and write',
    ])
    expect([...screen.getByLabelText('Statistics').options]).toHaveLength(2)
    // Falls back to the server's copy for a permission the UI doesn't know yet.
    expect(screen.getByText('A permission the UI has no copy for')).toBeInTheDocument()
  })

  it('requires a name', async () => {
    const onSave = vi.fn()
    render(
      <ApiKeyDialog apiKey={null} permissions={permissions} onSave={onSave} onClose={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the key a name.')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('creates with the chosen permissions and a 90-day default expiry', async () => {
    const onSave = vi.fn().mockResolvedValue()
    render(
      <ApiKeyDialog apiKey={null} permissions={permissions} onSave={onSave} onClose={vi.fn()} />
    )
    openAll()
    fireEvent.change(screen.getByPlaceholderText('e.g. Homepage widget'), {
      target: { value: ' Widget ' },
    })
    fireEvent.change(screen.getByLabelText('Books'), { target: { value: 'write' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const payload = onSave.mock.calls[0][0]
    expect(payload.name).toBe('Widget')
    expect(payload.permissions).toEqual({ books: 'write' })
    const days = (new Date(payload.expires_at) - Date.now()) / 86400000
    expect(Math.round(days)).toBe(90)
  })

  it('can create a key that never expires', async () => {
    const onSave = vi.fn().mockResolvedValue()
    render(
      <ApiKeyDialog apiKey={null} permissions={permissions} onSave={onSave} onClose={vi.fn()} />
    )
    fireEvent.change(screen.getByPlaceholderText('e.g. Homepage widget'), {
      target: { value: 'Forever' },
    })
    fireEvent.change(screen.getByDisplayValue('90 days'), { target: { value: 'never' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].expires_at).toBeNull()
  })

  it('edits without touching the expiry unless it is changed', async () => {
    const onSave = vi.fn().mockResolvedValue()
    const apiKey = {
      id: 'k1',
      name: 'Old',
      permissions: { stats: 'read' },
      expires_at: '2026-12-01T00:00:00+00:00',
    }
    render(
      <ApiKeyDialog apiKey={apiKey} permissions={permissions} onSave={onSave} onClose={vi.fn()} />
    )
    expect(screen.getByText('Edit API key')).toBeInTheDocument()
    expect(screen.getByLabelText('Statistics')).toHaveValue('read')
    expect(screen.getByText(/Keep current \(/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toEqual({ name: 'Old', permissions: { stats: 'read' } })
  })

  it('offers "keep current (never)" for a key with no expiry', () => {
    const apiKey = { id: 'k1', name: 'Old', permissions: {}, expires_at: null }
    render(
      <ApiKeyDialog apiKey={apiKey} permissions={permissions} onSave={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText('Keep current (never)')).toBeInTheDocument()
  })

  it('shows a save error and stays open', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Level not available'))
    render(
      <ApiKeyDialog apiKey={null} permissions={permissions} onSave={onSave} onClose={vi.fn()} />
    )
    fireEvent.change(screen.getByPlaceholderText('e.g. Homepage widget'), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Level not available')
  })

  it('closes on Cancel, Escape, or a backdrop click', () => {
    const onClose = vi.fn()
    render(
      <ApiKeyDialog apiKey={null} permissions={permissions} onSave={vi.fn()} onClose={onClose} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('All permissions sets a floor the individual pickers respect', async () => {
    const onSave = vi.fn().mockResolvedValue()
    render(
      <ApiKeyDialog apiKey={null} permissions={permissions} onSave={onSave} onClose={vi.fn()} />
    )
    openAll()
    fireEvent.change(screen.getByPlaceholderText('e.g. Homepage widget'), {
      target: { value: 'Everything' },
    })
    fireEvent.change(screen.getByLabelText('All permissions'), { target: { value: 'read' } })

    // Read-only areas are fully covered, so their picker is locked at Read.
    expect(screen.getByLabelText('Statistics')).toBeDisabled()
    expect(screen.getByLabelText('Statistics')).toHaveValue('read')
    // Books can still go higher, but not lower.
    const books = screen.getByLabelText('Books')
    expect(books).not.toBeDisabled()
    expect(books).toHaveValue('read')
    expect([...books.options].find((o) => o.value === 'none').disabled).toBe(true)
    fireEvent.change(books, { target: { value: 'write' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].permissions).toEqual({ '*': 'read', books: 'write' })
  })

  it('All permissions at Read and write locks every picker', () => {
    render(
      <ApiKeyDialog apiKey={null} permissions={permissions} onSave={vi.fn()} onClose={vi.fn()} />
    )
    openAll()
    fireEvent.change(screen.getByLabelText('All permissions'), { target: { value: 'write' } })
    expect(screen.getByLabelText('Books')).toBeDisabled()
    expect(screen.getByLabelText('Books')).toHaveValue('write')
  })

  describe('groups and filter', () => {
    const renderNew = () =>
      render(
        <ApiKeyDialog apiKey={null} permissions={permissions} onSave={vi.fn()} onClose={vi.fn()} />
      )

    it('lists permissions in collapsed groups, in server order', () => {
      renderNew()
      const headers = screen.getAllByRole('button', { expanded: false })
      expect(headers.map((h) => h.textContent)).toEqual([
        'Library0 of 2 with access',
        'Media0 of 1 with access',
        // An unknown group still shows, under its id.
        'mystery0 of 1 with access',
      ])
      expect(screen.queryByLabelText('Books')).toBeNull()
      // All permissions sits outside the groups, always visible.
      expect(screen.getByLabelText('All permissions')).toBeInTheDocument()
    })

    it('toggles a group open and closed', () => {
      renderNew()
      const library = screen.getByRole('button', { name: /Library/ })
      fireEvent.click(library)
      expect(library).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByLabelText('Books')).toBeInTheDocument()
      fireEvent.click(library)
      expect(screen.queryByLabelText('Books')).toBeNull()
    })

    it('counts what each group grants, including via All permissions', () => {
      renderNew()
      openAll()
      fireEvent.change(screen.getByLabelText('Books'), { target: { value: 'read' } })
      expect(screen.getByRole('button', { name: /Library/ })).toHaveTextContent(
        '1 of 2 with access'
      )
      fireEvent.change(screen.getByLabelText('All permissions'), { target: { value: 'read' } })
      expect(screen.getByRole('button', { name: /Media/ })).toHaveTextContent('1 of 1 with access')
    })

    it('opens groups that already grant something when editing', () => {
      render(
        <ApiKeyDialog
          apiKey={{ id: 'k1', name: 'Old', permissions: { maps: 'read' }, expires_at: null }}
          permissions={permissions}
          onSave={vi.fn()}
          onClose={vi.fn()}
        />
      )
      expect(screen.getByRole('button', { name: /Media/ })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('button', { name: /Library/ })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    })

    it('filters by name or description and opens the matching groups', () => {
      renderNew()
      const filter = screen.getByPlaceholderText('Filter permissions')
      fireEvent.change(filter, { target: { value: 'map' } })
      expect(screen.getByLabelText('Maps')).toBeInTheDocument()
      expect(screen.queryByLabelText('Books')).toBeNull()
      expect(screen.queryByRole('button', { name: /Library/ })).toBeNull()

      // Descriptions match too: "no copy for" only appears in the future one.
      fireEvent.change(filter, { target: { value: 'no copy for' } })
      expect(screen.getByText('A permission the UI has no copy for')).toBeInTheDocument()

      fireEvent.change(filter, { target: { value: 'zzz' } })
      expect(screen.getByText('No permissions match “zzz”')).toBeInTheDocument()

      // Clearing the filter folds the groups back to how they were.
      fireEvent.change(filter, { target: { value: '' } })
      expect(screen.queryByLabelText('Maps')).toBeNull()
    })
  })
})
