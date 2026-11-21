import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const navigate = vi.fn()
let routeState: unknown = null
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ state: routeState }),
}))

vi.mock('../../api', () => ({
  campaigns: {
    memberTokenUrl: vi.fn(
      (c: string, m: string, v?: number | null) => `/api/c/${c}/m/${m}/token?v=${v ?? ''}`
    ),
    ownerTokenUrl: vi.fn((c: string, v?: number | null) => `/api/c/${c}/owner/token?v=${v ?? ''}`),
    deleteMemberToken: vi.fn(),
    deleteOwnerToken: vi.fn(),
  },
}))

import { campaigns as campaignsApi } from '../../api'
import CharacterToken from './CharacterToken'

const campaigns = campaignsApi as unknown as Record<string, Mock>

const setup = (props: Partial<Parameters<typeof CharacterToken>[0]> = {}) =>
  render(
    <CharacterToken
      campaignId="c1"
      memberId="m1"
      name="Ireena Kolyana"
      hasToken
      canEdit
      {...props}
    />
  )

beforeEach(() => {
  vi.clearAllMocks()
  routeState = null
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

describe('CharacterToken', () => {
  it('renders nothing with no token and no right to make one', () => {
    const { container } = setup({ hasToken: false, canEdit: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a member’s token as a download', () => {
    setup({ canEdit: false })
    const link = screen.getByRole('link', { name: "Download Ireena Kolyana's token" })
    expect(link).toHaveAttribute('href', '/api/c/c1/m/m1/token?v=')
    expect(link).toHaveAttribute('download', 'ireena-kolyana-token.png')
    // Read-only: no editing actions.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the owner’s token from the campaign when there is no membership', () => {
    setup({ memberId: null })
    expect(screen.getByRole('link', { name: /token/ })).toHaveAttribute(
      'href',
      '/api/c/c1/owner/token?v='
    )
  })

  it('busts the cache with the stamp the editor returns with', () => {
    routeState = { artUpdated: 42 }
    setup()
    expect(screen.getByRole('link', { name: /token/ })).toHaveAttribute(
      'href',
      '/api/c/c1/m/m1/token?v=42'
    )
  })

  it('opens the editor bound to save a token, not art', async () => {
    setup({ hasToken: false })
    await userEvent.click(screen.getByRole('button', { name: 'Make a token for Ireena Kolyana' }))
    expect(navigate).toHaveBeenCalledWith('/tokens/editor', {
      state: { campaignId: 'c1', memberId: 'm1', memberName: 'Ireena Kolyana', saveAs: 'token' },
    })
  })

  it('binds the owner’s token with no member id', async () => {
    setup({ memberId: null })
    await userEvent.click(screen.getByRole('button', { name: /Make a new token/ }))
    expect(navigate).toHaveBeenCalledWith('/tokens/editor', {
      state: {
        campaignId: 'c1',
        memberId: undefined,
        memberName: 'Ireena Kolyana',
        saveAs: 'token',
      },
    })
  })

  it('removes a member’s token after confirming', async () => {
    const onChanged = vi.fn()
    campaigns.deleteMemberToken.mockResolvedValue(undefined)
    setup({ onChanged })
    await userEvent.click(screen.getByRole('button', { name: "Remove Ireena Kolyana's token" }))
    expect(campaigns.deleteMemberToken).toHaveBeenCalledWith('c1', 'm1')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('removes the owner’s token through the campaign', async () => {
    campaigns.deleteOwnerToken.mockResolvedValue(undefined)
    setup({ memberId: null })
    await userEvent.click(screen.getByRole('button', { name: /Remove/ }))
    expect(campaigns.deleteOwnerToken).toHaveBeenCalledWith('c1')
  })

  it('keeps the token when the removal is not confirmed', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    setup()
    await userEvent.click(screen.getByRole('button', { name: /Remove/ }))
    expect(campaigns.deleteMemberToken).not.toHaveBeenCalled()
  })

  it('alerts when the removal fails', async () => {
    const onChanged = vi.fn()
    campaigns.deleteMemberToken.mockRejectedValue(new Error('Campaign is archived'))
    setup({ onChanged })
    await userEvent.click(screen.getByRole('button', { name: /Remove/ }))
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Campaign is archived'))
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('reopens a token that kept its recipe, as it was', async () => {
    setup({ tokenEditable: true })
    await userEvent.click(screen.getByRole('button', { name: "Edit Ireena Kolyana's token" }))
    expect(navigate).toHaveBeenCalledWith('/tokens/editor', {
      state: {
        campaignId: 'c1',
        memberId: 'm1',
        memberName: 'Ireena Kolyana',
        saveAs: 'token',
        recipe: { kind: 'member', targetId: 'm1' },
      },
    })
  })

  it('reopens the owner’s token through the campaign', async () => {
    setup({ memberId: null, tokenEditable: true })
    await userEvent.click(screen.getByRole('button', { name: /^Edit/ }))
    expect(navigate.mock.calls[0][1].state.recipe).toEqual({ kind: 'owner', targetId: 'c1' })
  })

  it('offers a fresh token, not an edit, when there was no recipe', async () => {
    setup({ tokenEditable: false })
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Make a new token/ }))
    expect(navigate.mock.calls[0][1].state).not.toHaveProperty('recipe')
  })
})
