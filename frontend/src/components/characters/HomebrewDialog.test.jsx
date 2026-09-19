import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomebrewDialog from './HomebrewDialog'

const mockCreate = vi.fn()
const mockUpdate = vi.fn()
vi.mock('../../api', () => ({
  homebrew: {
    create: (...a) => mockCreate(...a),
    update: (...a) => mockUpdate(...a),
  },
}))

const TYPE = {
  identity_field: 'name',
  fields: {
    name: { type: 'text', label: 'Name' },
    level: { type: 'number', label: 'Level' },
    description: { type: 'textarea', label: 'Description' },
  },
}

const renderDialog = (props = {}) =>
  render(
    <HomebrewDialog
      schemaId="demo"
      contentType="spell"
      typeDefinition={TYPE}
      onClose={vi.fn()}
      {...props}
    />
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue({ id: 'new' })
  mockUpdate.mockResolvedValue({ id: 'h1' })
})

describe('HomebrewDialog', () => {
  it('builds its form from the content type', () => {
    renderDialog()
    // The same fields a catalog entry has, rendered by the same component.
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Level')).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toBeInTheDocument()
  })

  it('creates an entry', async () => {
    const onSaved = vi.fn()
    renderDialog({ onSaved })
    await userEvent.type(screen.getByLabelText('Name'), 'Hellfire')
    await userEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        schema_id: 'demo',
        content_type: 'spell',
        data: { name: 'Hellfire' },
      })
    )
    expect(onSaved).toHaveBeenCalled()
  })

  it('edits an existing entry rather than creating another', async () => {
    renderDialog({ entry: { id: 'h1', data: { name: 'Old', level: 2 } } })
    expect(screen.getByLabelText('Name')).toHaveValue('Old')
    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.type(screen.getByLabelText('Name'), 'New')
    await userEvent.click(screen.getByText('Save'))
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('h1', { data: { name: 'New', level: 2 } })
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('surfaces a validation failure from the server', async () => {
    mockCreate.mockRejectedValue(new Error('Entry needs a name'))
    renderDialog()
    await userEvent.click(screen.getByText('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Entry needs a name')
  })

  it('closes on Escape and on Cancel', async () => {
    const onClose = vi.fn()
    const { unmount } = renderDialog({ onClose })
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    unmount()

    const onClose2 = vi.fn()
    renderDialog({ onClose: onClose2 })
    await userEvent.click(screen.getByText('Cancel'))
    expect(onClose2).toHaveBeenCalled()
  })
})
