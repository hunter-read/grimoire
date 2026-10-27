import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import ApiKeySection from './ApiKeySection'
import { apiKeys } from '../../api'
import type { Schema } from '../../api'

vi.mock('../../api', () => ({
  apiKeys: {
    list: vi.fn(),
    permissions: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    regenerate: vi.fn(),
    revoke: vi.fn(),
  },
}))

const permissions = [
  {
    id: 'stats',
    group: 'library',
    tags: ['stats'],
    description: 'stats',
    levels: ['none', 'read'],
  },
  {
    id: 'books',
    group: 'library',
    tags: ['books'],
    description: 'books',
    levels: ['none', 'read', 'write'],
  },
]

const key = (overrides: Partial<Schema<'ApiKeyOut'>> = {}): Schema<'ApiKeyOut'> => ({
  user_id: 'u1',
  id: 'k1',
  name: 'Homepage',
  prefix: 'grim_abc1234',
  permissions: { stats: 'read' },
  created_at: '2026-08-01T10:00:00+00:00',
  last_used_at: null,
  expires_at: null,
  expired: false,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiKeys.permissions).mockResolvedValue(permissions)
})

describe('ApiKeySection', () => {
  it('says when there are no keys', async () => {
    vi.mocked(apiKeys.list).mockResolvedValue([])
    render(<ApiKeySection />)
    expect(await screen.findByText('No API keys yet.')).toBeInTheDocument()
  })

  it('shows a load error', async () => {
    vi.mocked(apiKeys.list).mockRejectedValue(new Error('Admin access required'))
    render(<ApiKeySection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required')
  })

  it('lists keys by name and prefix', async () => {
    vi.mocked(apiKeys.list).mockResolvedValue([key()])
    render(<ApiKeySection />)
    expect(await screen.findByText('Homepage')).toBeInTheDocument()
    expect(screen.getByText('grim_abc1234…')).toBeInTheDocument()
  })

  it('creates a key and reveals it once', async () => {
    vi.mocked(apiKeys.list).mockResolvedValue([])
    vi.mocked(apiKeys.create).mockResolvedValue({
      api_key: key({ id: 'k2', name: 'Script' }),
      key: 'grim_full-secret',
    })
    render(<ApiKeySection />)
    fireEvent.click(await screen.findByRole('button', { name: /Create API key/ }))
    fireEvent.change(screen.getByPlaceholderText('e.g. Homepage widget'), {
      target: { value: 'Script' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))

    expect(await screen.findByTestId('api-key-secret')).toHaveTextContent('grim_full-secret')
    expect(apiKeys.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Script' }))

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('grim_full-secret')).toBeNull()
    expect(screen.getByText('Script')).toBeInTheDocument()
  })

  it('edits a key in place', async () => {
    vi.mocked(apiKeys.list).mockResolvedValue([key()])
    vi.mocked(apiKeys.update).mockResolvedValue(key({ name: 'Renamed' }))
    render(<ApiKeySection />)
    fireEvent.click(await screen.findByRole('button', { name: /Edit/ }))
    fireEvent.change(screen.getByDisplayValue('Homepage'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Renamed')).toBeInTheDocument()
    expect(apiKeys.update).toHaveBeenCalledWith('k1', {
      name: 'Renamed',
      permissions: { stats: 'read' },
    })
  })

  it('regenerates after confirming and reveals the new key', async () => {
    vi.mocked(apiKeys.list).mockResolvedValue([key()])
    vi.mocked(apiKeys.regenerate).mockResolvedValue({
      api_key: key({ prefix: 'grim_new1234' }),
      key: 'grim_new-secret',
    })
    render(<ApiKeySection />)
    fireEvent.click(await screen.findByRole('button', { name: /Regenerate/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Regenerate .Homepage.\?/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByTestId('api-key-secret')).toHaveTextContent('grim_new-secret')
    expect(apiKeys.regenerate).toHaveBeenCalledWith('k1')
    expect(screen.getByText('grim_new1234…')).toBeInTheDocument()
  })

  it('revokes after confirming', async () => {
    vi.mocked(apiKeys.list).mockResolvedValue([key()])
    vi.mocked(apiKeys.revoke).mockResolvedValue(null)
    render(<ApiKeySection />)
    fireEvent.click(await screen.findByRole('button', { name: /Revoke/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.queryByText('Homepage')).toBeNull())
    expect(apiKeys.revoke).toHaveBeenCalledWith('k1')
    expect(screen.getByText('No API keys yet.')).toBeInTheDocument()
  })

  it('does nothing when the confirmation is cancelled', async () => {
    vi.mocked(apiKeys.list).mockResolvedValue([key()])
    render(<ApiKeySection />)
    fireEvent.click(await screen.findByRole('button', { name: /Revoke/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(apiKeys.revoke).not.toHaveBeenCalled()
    expect(screen.getByText('Homepage')).toBeInTheDocument()
  })

  it('shows an error when an action fails', async () => {
    vi.mocked(apiKeys.list).mockResolvedValue([key()])
    vi.mocked(apiKeys.revoke).mockRejectedValue(new Error('Nope'))
    render(<ApiKeySection />)
    fireEvent.click(await screen.findByRole('button', { name: /Revoke/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
    expect(screen.getByText('Homepage')).toBeInTheDocument()
  })

  describe('everyone view', () => {
    it("lists every user's keys with owners, and no create button", async () => {
      vi.mocked(apiKeys.list).mockResolvedValue([key({ username: 'gmuser' })])
      render(<ApiKeySection scope="all" />)
      expect(await screen.findByText('All API Keys')).toBeInTheDocument()
      expect(apiKeys.list).toHaveBeenCalledWith(true)
      expect(screen.getByText('Owner: gmuser')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Create API key/ })).toBeNull()
    })

    it("revokes someone else's key", async () => {
      vi.mocked(apiKeys.list).mockResolvedValue([key({ username: 'gmuser' })])
      vi.mocked(apiKeys.revoke).mockResolvedValue(null)
      render(<ApiKeySection scope="all" />)
      fireEvent.click(await screen.findByRole('button', { name: /Revoke/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      await waitFor(() => expect(apiKeys.revoke).toHaveBeenCalledWith('k1'))
    })
  })
})
