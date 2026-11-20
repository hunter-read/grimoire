import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompendiumLinksPanel from './CompendiumLinksPanel'
import { PACK, summary } from '../../test/compendiumFixtures'

const mockGet = vi.fn()
const mockSetLinks = vi.fn()
const mockPacks = vi.fn()
const mockSchemas = vi.fn()
vi.mock('../../api', () => ({
  compendium: {
    get: (...a: unknown[]) => mockGet(...a),
    setLinks: (...a: unknown[]) => mockSetLinks(...a),
  },
  content: { packs: (...a: unknown[]) => mockPacks(...a) },
  characters: { listSchemas: (...a: unknown[]) => mockSchemas(...a) },
}))

beforeEach(() => {
  mockGet.mockResolvedValue(
    summary({
      packs: [PACK, { pack_id: 'gone', name: 'gone', installed: false }],
      sheets: [{ schema_id: 'old-sheet', name: 'Old sheet', available: false }],
    })
  )
  mockPacks.mockResolvedValue({
    packs: [
      { pack_id: 'demo-srd', name: 'Demo SRD', entry_count: 12 },
      { pack_id: 'extra', name: 'Extra', entry_count: 1 },
    ],
  })
  mockSchemas.mockResolvedValue({
    schemas: [
      { schema_id: 'demo', name: 'Demo sheet', system: 'Demo', server_wide: true },
      { schema_id: 'mine', name: 'My sheet', system: '' },
    ],
  })
  mockSetLinks.mockReset()
})

describe('CompendiumLinksPanel', () => {
  it('ticks what is linked, and keeps a link whose pack or sheet has gone', async () => {
    render(<CompendiumLinksPanel systemId="s1" />)
    expect(await screen.findByRole('checkbox', { name: /Demo SRD/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Extra/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /gone · not installed/ })).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /Demo sheet · Demo · for everyone/ })
    ).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Old sheet · not installed/ })).toBeChecked()
  })

  it('saves a change at once and reports it', async () => {
    const onChange = vi.fn()
    const saved = summary({ packs: [PACK, { pack_id: 'extra', name: 'Extra', installed: true }] })
    mockSetLinks.mockResolvedValue(saved)
    render(<CompendiumLinksPanel systemId="s1" onChange={onChange} />)
    await userEvent.click(await screen.findByRole('checkbox', { name: /Extra/ }))
    expect(mockSetLinks).toHaveBeenCalledWith('s1', { pack_ids: ['demo-srd', 'gone', 'extra'] })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved))
    await userEvent.click(screen.getByRole('checkbox', { name: /My sheet/ }))
    expect(mockSetLinks).toHaveBeenLastCalledWith('s1', { sheet_ids: ['mine'] })
  })

  it('unlinks by unticking', async () => {
    mockSetLinks.mockResolvedValue(summary({ packs: [] }))
    render(<CompendiumLinksPanel systemId="s1" />)
    await userEvent.click(await screen.findByRole('checkbox', { name: /Demo SRD/ }))
    expect(mockSetLinks).toHaveBeenCalledWith('s1', { pack_ids: ['gone'] })
  })

  it('says why a change failed', async () => {
    mockSetLinks.mockRejectedValue(new Error('Not an installed content pack: extra'))
    render(<CompendiumLinksPanel systemId="s1" />)
    await userEvent.click(await screen.findByRole('checkbox', { name: /Extra/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not an installed content pack')
  })

  it('explains an empty list', async () => {
    mockGet.mockResolvedValue(summary({ packs: [], sheets: [] }))
    mockPacks.mockResolvedValue({ packs: [] })
    mockSchemas.mockResolvedValue({ schemas: [] })
    render(<CompendiumLinksPanel systemId="s1" />)
    expect(await screen.findByText(/No content packs are installed/)).toBeInTheDocument()
    expect(screen.getByText('You have no character sheets installed.')).toBeInTheDocument()
  })

  it('says why it could not load', async () => {
    mockGet.mockRejectedValue(new Error('System not found'))
    render(<CompendiumLinksPanel systemId="s1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('System not found')
  })
})
