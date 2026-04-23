import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemberRow, InvitePanel } from './CampaignMembers'

vi.mock('../../api', () => ({
  campaigns: {
    eligibleMembers: vi.fn(),
    invite: vi.fn(),
  },
}))

import { campaigns } from '../../api'

const baseMember = {
  user_id: 'u1',
  username: 'alice',
  display_name: null,
  character_name: null,
  status: 'accepted',
}

function renderRow(overrides = {}, props = {}) {
  const member = { ...baseMember, ...overrides }
  return render(
    <MemberRow
      member={member}
      isOwner={false}
      canManage={false}
      currentUserId="other"
      onRemove={vi.fn()}
      onUpdateStatus={vi.fn()}
      onSetCharacterName={vi.fn()}
      {...props}
    />
  )
}

describe('MemberRow', () => {
  it('shows username when display_name is null', () => {
    renderRow({ display_name: null, username: 'alice' })
    expect(screen.getByText('alice')).toBeTruthy()
  })

  it('shows display_name when set', () => {
    renderRow({ display_name: 'Alice Smith', username: 'alice' })
    expect(screen.getByText('Alice Smith')).toBeTruthy()
    expect(screen.queryByText('alice')).toBeNull()
  })

  it('shows "(you)" label for the current user', () => {
    renderRow({}, { currentUserId: 'u1' })
    expect(screen.getByText(/\(you\)/)).toBeTruthy()
  })

  it('does not show "(you)" for other users', () => {
    renderRow({}, { currentUserId: 'u2' })
    expect(screen.queryByText(/\(you\)/)).toBeNull()
  })

  it('shows member status badge', () => {
    renderRow({ status: 'invited' })
    expect(screen.getByText('invited')).toBeTruthy()
  })

  it('shows accept/decline buttons for current user with invited status', () => {
    renderRow({ status: 'invited' }, { currentUserId: 'u1' })
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy()
  })

  it('does not show accept/decline for another user with invited status', () => {
    renderRow({ status: 'invited' }, { currentUserId: 'u2' })
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })

  it('calls onUpdateStatus with accepted when Accept is clicked', () => {
    const onUpdateStatus = vi.fn()
    renderRow({ status: 'invited' }, { currentUserId: 'u1', onUpdateStatus })
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onUpdateStatus).toHaveBeenCalledWith('u1', 'accepted')
  })

  it('calls onUpdateStatus with declined when Decline is clicked', () => {
    const onUpdateStatus = vi.fn()
    renderRow({ status: 'invited' }, { currentUserId: 'u1', onUpdateStatus })
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(onUpdateStatus).toHaveBeenCalledWith('u1', 'declined')
  })

  it('shows remove button for non-self members when canManage is true', () => {
    renderRow({}, { canManage: true, currentUserId: 'other' })
    expect(screen.getByRole('button', { name: /Remove alice/ })).toBeTruthy()
  })

  it('does not show remove button for self even when canManage is true', () => {
    renderRow({}, { canManage: true, currentUserId: 'u1' })
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
  })

  it('calls onRemove when Remove is clicked', () => {
    const onRemove = vi.fn()
    renderRow({}, { canManage: true, currentUserId: 'other', onRemove })
    fireEvent.click(screen.getByRole('button', { name: /Remove alice/ }))
    expect(onRemove).toHaveBeenCalledWith('u1')
  })

  it('shows character name when set', () => {
    renderRow({ character_name: 'Elara the Bold' })
    expect(screen.getByText('Elara the Bold')).toBeTruthy()
  })

  it('shows "No character name" placeholder when unset', () => {
    renderRow({ character_name: null })
    expect(screen.getByText('No character name')).toBeTruthy()
  })
})

describe('InvitePanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows users available to invite', async () => {
    campaigns.eligibleMembers.mockResolvedValue([
      { id: 'u2', username: 'bob', display_name: null, role: 'player', already_invited: false },
    ])
    render(<InvitePanel campaignId="c1" onInvited={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('bob')).toBeTruthy())
    expect(screen.getByText('Invite')).toBeTruthy()
  })

  it('shows message when all users are already invited', async () => {
    campaigns.eligibleMembers.mockResolvedValue([
      { id: 'u2', username: 'bob', display_name: null, role: 'player', already_invited: true },
    ])
    render(<InvitePanel campaignId="c1" onInvited={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('All users have already been invited.')).toBeTruthy()
    )
  })

  it('calls invite and onInvited when Invite button is clicked', async () => {
    campaigns.eligibleMembers.mockResolvedValue([
      { id: 'u2', username: 'bob', display_name: null, role: 'player', already_invited: false },
    ])
    campaigns.invite.mockResolvedValue({})
    const onInvited = vi.fn()
    render(<InvitePanel campaignId="c1" onInvited={onInvited} />)
    await waitFor(() => screen.getByText('bob'))
    fireEvent.click(screen.getByText('Invite'))
    await waitFor(() => expect(campaigns.invite).toHaveBeenCalledWith('c1', 'u2'))
    expect(onInvited).toHaveBeenCalled()
  })
})
