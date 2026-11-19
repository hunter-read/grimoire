import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SheetCatalogue from './SheetCatalogue'

const mockBrowse = vi.fn()
const mockInstall = vi.fn()
let role = 'admin'
vi.mock('../../api', () => ({
  characters: {
    browseSheets: (...a: unknown[]) => mockBrowse(...a),
    installSheet: (...a: unknown[]) => mockInstall(...a),
  },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }))

const sheet = (overrides: Record<string, unknown> = {}) => ({
  id: 'cairn',
  raw_id: 'cairn',
  name: 'Cairn',
  version: '1.1.0',
  index_url: 'https://example.test/main/character-sheets/index.json',
  installed: false,
  installed_server_wide: false,
  ...overrides,
})

const listing = (...sheets: Record<string, unknown>[]) => ({ sheets, sources: [], errors: [] })

beforeEach(() => {
  role = 'admin'
  mockBrowse.mockReset()
  mockInstall.mockReset().mockResolvedValue({})
})

describe('SheetCatalogue - for everyone', () => {
  it('lets an admin install a sheet for everyone', async () => {
    mockBrowse.mockResolvedValue(listing(sheet()))
    render(<SheetCatalogue />)
    await userEvent.click(await screen.findByRole('button', { name: 'Install Cairn for everyone' }))
    await waitFor(() => expect(mockInstall).toHaveBeenCalledWith('cairn', true))
    expect(await screen.findByText('Installed for everyone')).toBeInTheDocument()
    // Their own copy is still theirs to install.
    expect(screen.getByRole('button', { name: 'Install Cairn' })).toBeInTheDocument()
  })

  it('offers an admin the update for everyone', async () => {
    mockBrowse.mockResolvedValue(
      listing(
        sheet({
          installed_server_wide: true,
          server_installed_version: '1.0.0',
          server_update_available: true,
        })
      )
    )
    render(<SheetCatalogue />)
    await userEvent.click(await screen.findByRole('button', { name: /Update everyone to v1.1.0/ }))
    await waitFor(() => expect(mockInstall).toHaveBeenCalledWith('cairn', true))
  })

  it('tells anyone else a server-wide sheet is already theirs to use', async () => {
    role = 'player'
    mockBrowse.mockResolvedValue(listing(sheet({ installed_server_wide: true })))
    render(<SheetCatalogue />)
    expect(await screen.findByText('Available to everyone')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Install/ })).toBeNull()
  })
})
