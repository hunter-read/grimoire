import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CharacterPlacement from './CharacterPlacement'

const mockUpdate = vi.fn()
const mockCampaigns = vi.fn()
vi.mock('../../api', () => ({
  campaigns: { list: (...a) => mockCampaigns(...a) },
  characters: { update: (...a) => mockUpdate(...a) },
}))

const CHARACTER = { id: 'c1', name: 'Vex', campaign_id: null, status: 'active' }

const renderPlacement = (props = {}) => {
  const onChanged = vi.fn()
  const onError = vi.fn()
  render(
    <CharacterPlacement character={CHARACTER} onChanged={onChanged} onError={onError} {...props} />
  )
  return { onChanged, onError }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCampaigns.mockResolvedValue([
    { id: 'personal', name: 'My Notes', invitation_status: null },
    { id: 'joined', name: 'Strahd', invitation_status: 'accepted' },
    { id: 'pending', name: 'Pending Invite', invitation_status: 'invited' },
  ])
})

describe('CharacterPlacement', () => {
  it('offers owned and joined campaigns, but not pending invitations', async () => {
    renderPlacement()
    expect(await screen.findByRole('option', { name: 'My Notes' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Strahd' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Pending Invite' })).not.toBeInTheDocument()
  })

  it('saves a new campaign and reports the result', async () => {
    mockUpdate.mockResolvedValue({ ...CHARACTER, campaign_id: 'personal' })
    const { onChanged } = renderPlacement()
    await screen.findByRole('option', { name: 'My Notes' })
    await userEvent.selectOptions(screen.getByLabelText('Campaign'), 'personal')
    expect(mockUpdate).toHaveBeenCalledWith('c1', { campaign_id: 'personal' })
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ campaign_id: 'personal' }))
    )
  })

  it('clears the campaign with an empty id', async () => {
    mockUpdate.mockResolvedValue({ ...CHARACTER, campaign_id: null })
    renderPlacement({ character: { ...CHARACTER, campaign_id: 'joined' } })
    await screen.findByRole('option', { name: 'Strahd' })
    await userEvent.selectOptions(screen.getByLabelText('Campaign'), '')
    expect(mockUpdate).toHaveBeenCalledWith('c1', { campaign_id: '' })
  })

  it('keeps the current campaign selectable when the list leaves it out', async () => {
    renderPlacement({
      character: { ...CHARACTER, campaign_id: 'archived', campaign_name: 'Old Game' },
    })
    expect(await screen.findByRole('option', { name: 'Old Game' })).toBeInTheDocument()
    expect(screen.getByLabelText('Campaign')).toHaveValue('archived')
  })

  it('changes the status', async () => {
    mockUpdate.mockResolvedValue({ ...CHARACTER, status: 'retired' })
    renderPlacement()
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'retired')
    expect(mockUpdate).toHaveBeenCalledWith('c1', { status: 'retired' })
  })

  it('reports a refused save', async () => {
    mockUpdate.mockRejectedValue(new Error('You are not in that campaign'))
    const { onError } = renderPlacement()
    await screen.findByRole('option', { name: 'My Notes' })
    await userEvent.selectOptions(screen.getByLabelText('Campaign'), 'personal')
    await waitFor(() => expect(onError).toHaveBeenCalledWith('You are not in that campaign'))
  })

  it('shows plain labels on a party member’s sheet, without loading campaigns', () => {
    renderPlacement({
      readOnly: true,
      character: { ...CHARACTER, campaign_id: 'joined', campaign_name: 'Strahd', status: 'dead' },
    })
    expect(screen.getByText('· Strahd')).toBeInTheDocument()
    expect(screen.getByText('· Dead')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(mockCampaigns).not.toHaveBeenCalled()
  })
})
