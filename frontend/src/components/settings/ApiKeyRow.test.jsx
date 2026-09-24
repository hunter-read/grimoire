import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ApiKeyRow from './ApiKeyRow'

const permissions = [
  { id: 'stats', levels: ['none', 'read'] },
  { id: 'books', levels: ['none', 'read', 'write'] },
]

const key = (overrides = {}) => ({
  id: 'k1',
  name: 'Homepage',
  prefix: 'grim_abc1234',
  permissions: { stats: 'read', books: 'write' },
  created_at: '2026-08-01T10:00:00+00:00',
  last_used_at: null,
  expires_at: null,
  expired: false,
  ...overrides,
})

const renderRow = (apiKey, handlers = {}, showOwner = false) =>
  render(
    <ApiKeyRow
      apiKey={apiKey}
      permissions={permissions}
      showOwner={showOwner}
      onEdit={handlers.onEdit || vi.fn()}
      onRegenerate={handlers.onRegenerate || vi.fn()}
      onRevoke={handlers.onRevoke || vi.fn()}
    />
  )

describe('ApiKeyRow', () => {
  it('shows name, prefix, permissions and usage, never a secret', () => {
    renderRow(key())
    expect(screen.getByText('Homepage')).toBeInTheDocument()
    expect(screen.getByText('grim_abc1234…')).toBeInTheDocument()
    expect(screen.getByText('Statistics: Read · Books: Read and write')).toBeInTheDocument()
    expect(screen.getByText(/Never used/)).toBeInTheDocument()
    expect(screen.getByText('Never expires')).toBeInTheDocument()
  })

  it('shows last use and expiry dates', () => {
    renderRow(
      key({ last_used_at: '2026-08-02T10:00:00+00:00', expires_at: '2026-12-01T00:00:00+00:00' })
    )
    expect(screen.getByText(/Last used/)).toBeInTheDocument()
    expect(screen.getByText(/^Expires /)).toBeInTheDocument()
  })

  it('marks an expired key', () => {
    renderRow(key({ expires_at: '2026-01-01T00:00:00+00:00', expired: true }))
    expect(screen.getByText(/^Expired /)).toBeInTheDocument()
  })

  it('says when a key has no permissions', () => {
    renderRow(key({ permissions: {} }))
    expect(screen.getByText('No permissions')).toBeInTheDocument()
  })

  it('wires the edit, regenerate and revoke actions', () => {
    const handlers = { onEdit: vi.fn(), onRegenerate: vi.fn(), onRevoke: vi.fn() }
    const apiKey = key()
    renderRow(apiKey, handlers)
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }))
    fireEvent.click(screen.getByRole('button', { name: /Revoke/ }))
    expect(handlers.onEdit).toHaveBeenCalledWith(apiKey)
    expect(handlers.onRegenerate).toHaveBeenCalledWith(apiKey)
    expect(handlers.onRevoke).toHaveBeenCalledWith(apiKey)
  })

  it('in the everyone-view names the owner and offers only Revoke', () => {
    const onRevoke = vi.fn()
    renderRow(key({ username: 'gmuser' }), { onRevoke }, true)
    expect(screen.getByText('Owner: gmuser')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Regenerate/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Revoke/ }))
    expect(onRevoke).toHaveBeenCalled()
  })

  it('summarises All permissions', () => {
    renderRow(key({ permissions: { '*': 'read', books: 'write' } }))
    expect(screen.getByText('All permissions: Read · Books: Read and write')).toBeInTheDocument()
  })
})
