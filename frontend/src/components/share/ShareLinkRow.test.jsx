import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareLinkRow from './ShareLinkRow'
import ShareLinkStateBadge from './ShareLinkStateBadge'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k),
    i18n: { language: 'en-US' },
  }),
}))

const base = {
  id: 'l1',
  url: 'https://g.example/share/tok',
  file_url: 'https://g.example/api/share/tok/tavern.png',
  resource_type: 'map',
  resource_id: 'm1',
  resource_name: 'Old Tavern',
  label: 'Session 4',
  filename: 'tavern.png',
  has_password: false,
  state: 'active',
  created_at: '2026-10-01T00:00:00Z',
  expires_at: '2026-10-20T00:00:00Z',
  revoked_at: null,
  last_used_at: '2026-10-02T00:00:00Z',
  use_count: 3,
}

const renderRow = (props = {}) =>
  render(
    <ul>
      <ShareLinkRow link={base} onRevoke={vi.fn()} onDelete={vi.fn()} {...props} />
    </ul>
  )

let writeText
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('ShareLinkRow', () => {
  it('shows the label, state, expiry and use count', () => {
    renderRow()
    expect(screen.getByText('Session 4')).toBeInTheDocument()
    expect(screen.getByText('share.state.active')).toBeInTheDocument()
    expect(screen.getByText(/share.row.uses:\{"count":3\}/)).toBeInTheDocument()
    expect(screen.getByText(/share.row.expires/)).toBeInTheDocument()
  })

  it('names the item and its owner in the cross-item lists', () => {
    renderRow({ link: { ...base, username: 'gm' }, showItem: true, showOwner: true })
    expect(screen.getByText('Old Tavern')).toBeInTheDocument()
    expect(screen.getByText('Session 4')).toBeInTheDocument()
    expect(screen.getByText(/share.row.owner/)).toBeInTheDocument()
    expect(screen.getByText(/share.type.map/)).toBeInTheDocument()
  })

  it('copies the page link and the file link', async () => {
    renderRow()
    fireEvent.click(screen.getByText('share.row.copyLink'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(base.url))
    expect(await screen.findByText('share.row.copied')).toBeInTheDocument()
    fireEvent.click(screen.getByText('share.row.copyFile'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(base.file_url))
  })

  it('survives a clipboard that refuses', async () => {
    writeText.mockRejectedValue(new Error('no'))
    renderRow()
    fireEvent.click(screen.getByText('share.row.copyLink'))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(screen.queryByText('share.row.copied')).toBeNull()
  })

  // A tool loading the file directly cannot type a password.
  it('offers no file URL for a password-protected link', () => {
    renderRow({ link: { ...base, has_password: true } })
    expect(screen.queryByText('share.row.copyFile')).toBeNull()
    expect(screen.getByLabelText('share.row.passwordProtected')).toBeInTheDocument()
  })

  it('revokes', () => {
    const onRevoke = vi.fn()
    renderRow({ onRevoke })
    fireEvent.click(screen.getByText('share.row.revoke'))
    expect(onRevoke).toHaveBeenCalledWith(base)
  })

  it('offers delete, with a confirmation, only once revoked', () => {
    const onDelete = vi.fn()
    renderRow({ link: { ...base, state: 'revoked' }, onDelete })
    expect(screen.queryByText('share.row.revoke')).toBeNull()
    expect(screen.queryByText('share.row.copyLink')).toBeNull()
    fireEvent.click(screen.getByText('share.row.delete'))
    fireEvent.click(screen.getByText('common.cancel'))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('share.row.delete'))
    fireEvent.click(screen.getByText('share.row.confirmDelete'))
    expect(onDelete).toHaveBeenCalledWith({ ...base, state: 'revoked' })
  })

  it('says when a link never expires and falls back to the filename', () => {
    renderRow({ link: { ...base, label: '', expires_at: null, last_used_at: null } })
    expect(screen.getByText('tavern.png')).toBeInTheDocument()
    expect(screen.getByText(/share.row.noExpiry/)).toBeInTheDocument()
  })
})

describe('ShareLinkStateBadge', () => {
  it('explains a state in its tooltip', () => {
    render(<ShareLinkStateBadge state="suspended" />)
    expect(screen.getByText('share.state.suspended')).toHaveAttribute(
      'title',
      'share.stateHint.suspended'
    )
  })

  it('tolerates an unknown state', () => {
    render(<ShareLinkStateBadge state="mystery" />)
    expect(screen.getByText('share.state.mystery')).toBeInTheDocument()
  })
})
