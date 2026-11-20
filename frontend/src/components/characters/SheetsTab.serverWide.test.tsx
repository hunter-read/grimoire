import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SheetsTab from './SheetsTab'
import type { Schema } from '../../api'

// Sheets an admin installed for everyone on the server.

const mockImportSchema = vi.fn()
const mockDeleteSchema = vi.fn()
const mockSheetUpdates = vi.fn()
const mockInstallSheet = vi.fn()
let role = 'admin'

vi.mock('../../api', () => ({
  characters: {
    importSchema: (...a: unknown[]) => mockImportSchema(...a),
    deleteSchema: (...a: unknown[]) => mockDeleteSchema(...a),
    sheetUpdates: (...a: unknown[]) => mockSheetUpdates(...a),
    installSheet: (...a: unknown[]) => mockInstallSheet(...a),
  },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }))

const SERVER = {
  schema_id: 'dnd-5e',
  name: 'D&D 5e',
  system: 'D&D',
  version: '1.0.0',
  is_community: true,
  server_wide: true,
  character_count: 0,
} as Schema<'SchemaSummary'>

const renderTab = () =>
  render(<SheetsTab schemas={[SERVER]} onChanged={vi.fn()} onBrowse={vi.fn()} setError={vi.fn()} />)

beforeEach(() => {
  role = 'admin'
  mockImportSchema.mockReset().mockResolvedValue({ name: 'X', schema_id: 'x' })
  mockDeleteSchema.mockReset().mockResolvedValue({})
  mockInstallSheet.mockReset().mockResolvedValue({})
  mockSheetUpdates.mockReset().mockResolvedValue({ updates: [] })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('SheetsTab - for everyone', () => {
  it('marks a server-wide sheet, and an admin removes it for everyone', async () => {
    renderTab()
    expect(screen.getByText(/for everyone/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove D&D 5e for everyone' }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('for everyone'))
    await waitFor(() => expect(mockDeleteSchema).toHaveBeenCalledWith('dnd-5e', true))
  })

  it('gives anyone else no way to remove or update it', async () => {
    role = 'player'
    mockSheetUpdates.mockResolvedValue({
      updates: [
        { schema_id: 'dnd-5e', name: 'D&D 5e', version: '2.0.0', sheet_id: 'x', server_wide: true },
      ],
    })
    renderTab()
    await waitFor(() => expect(mockSheetUpdates).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull()
  })

  it('updates the server-wide copy for an admin', async () => {
    mockSheetUpdates.mockResolvedValue({
      updates: [
        {
          schema_id: 'dnd-5e',
          name: 'D&D 5e',
          version: '2.0.0',
          sheet_id: 'dnd-abc',
          server_wide: true,
        },
      ],
    })
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /Update D&D 5e/ }))
    await waitFor(() => expect(mockInstallSheet).toHaveBeenCalledWith('dnd-abc', true))
  })

  it('lets an admin paste a sheet for everyone', async () => {
    renderTab()
    await userEvent.click(screen.getByRole('button', { name: /Paste/ }))
    await userEvent.type(screen.getByLabelText(/Sheet \(JSON or YAML\)/i), 'id: x')
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Install for everyone on this server' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() =>
      expect(mockImportSchema).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'id: x' }),
        true
      )
    )
  })

  it('offers a player no for-everyone paste', async () => {
    role = 'player'
    renderTab()
    await userEvent.click(screen.getByRole('button', { name: /Paste/ }))
    expect(screen.queryByRole('checkbox', { name: /for everyone/ })).toBeNull()
  })
})
