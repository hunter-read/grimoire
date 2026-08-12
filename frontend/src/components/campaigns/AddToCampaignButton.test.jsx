import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddToCampaignButton from './AddToCampaignButton'
import { campaigns } from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

let mockUser = { id: 7, username: 'gm' }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

let mockUISettings = { hide_campaigns: false }
vi.mock('../../context/UISettingsContext', () => ({ useUISettings: () => mockUISettings }))

vi.mock('../../api', () => ({
  campaigns: { list: vi.fn(), listResources: vi.fn(), addResource: vi.fn() },
}))

const owned = [
  { id: 10, name: 'Curse of Strahd', owner_id: 7 },
  { id: 11, name: 'Avernus', owner_id: 7, gm_title: 'Dungeon Master' },
]

const renderButton = (props = {}) =>
  render(<AddToCampaignButton resourceType="book" resourceId={5} {...props} />)

beforeEach(() => {
  vi.clearAllMocks()
  mockUser = { id: 7, username: 'gm' }
  mockUISettings = { hide_campaigns: false }
  campaigns.listResources.mockResolvedValue([])
})

describe('AddToCampaignButton', () => {
  it('renders nothing when campaigns are hidden', () => {
    mockUISettings = { hide_campaigns: true }
    const { container } = renderButton()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the trigger without loading campaigns until it is opened', () => {
    renderButton()
    expect(screen.getByTitle('resources.addToCampaign')).toBeInTheDocument()
    expect(campaigns.list).not.toHaveBeenCalled()
  })

  it('applies a style override to the trigger', () => {
    renderButton({ style: { marginTop: 12 } })
    expect(screen.getByTitle('resources.addToCampaign')).toHaveStyle({ marginTop: '12px' })
  })

  it('loads and lists only campaigns the user owns when opened', async () => {
    campaigns.list.mockResolvedValue([...owned, { id: 12, name: 'Not Mine', owner_id: 99 }])
    renderButton()
    await userEvent.click(screen.getByTitle('resources.addToCampaign'))

    expect(await screen.findByText('Curse of Strahd')).toBeInTheDocument()
    expect(screen.getByText('Dungeon Master')).toBeInTheDocument()
    expect(screen.queryByText('Not Mine')).not.toBeInTheDocument()
  })

  it('shows a loading state while the campaigns are fetched', async () => {
    campaigns.list.mockReturnValue(new Promise(() => {}))
    renderButton()
    await userEvent.click(screen.getByTitle('resources.addToCampaign'))
    expect(screen.getByText('common.loading')).toBeInTheDocument()
  })

  it('shows the empty state when the user owns no campaigns', async () => {
    campaigns.list.mockResolvedValue([])
    renderButton()
    await userEvent.click(screen.getByTitle('resources.addToCampaign'))
    expect(await screen.findByText('resources.noCampaigns')).toBeInTheDocument()
  })

  it('falls back to an empty list when the fetch fails', async () => {
    campaigns.list.mockRejectedValue(new Error('offline'))
    renderButton()
    await userEvent.click(screen.getByTitle('resources.addToCampaign'))
    expect(await screen.findByText('resources.noCampaigns')).toBeInTheDocument()
  })

  it('marks campaigns that already contain the resource as added', async () => {
    campaigns.list.mockResolvedValue(owned)
    campaigns.listResources.mockImplementation((id) =>
      Promise.resolve(id === 10 ? [{ resource_type: 'book', resource_id: 5 }] : [])
    )
    renderButton()
    await userEvent.click(screen.getByTitle('resources.addToCampaign'))

    expect(await screen.findByText('resources.added')).toBeInTheDocument()
    expect(campaigns.listResources).toHaveBeenCalledTimes(2)
  })

  it('ignores a per-campaign resource lookup failure', async () => {
    campaigns.list.mockResolvedValue(owned)
    campaigns.listResources.mockRejectedValue(new Error('boom'))
    renderButton()
    await userEvent.click(screen.getByTitle('resources.addToCampaign'))

    expect(await screen.findByText('Curse of Strahd')).toBeInTheDocument()
    expect(screen.queryByText('resources.added')).not.toBeInTheDocument()
  })

  it('adds the resource to the chosen campaign', async () => {
    campaigns.list.mockResolvedValue(owned)
    campaigns.addResource.mockResolvedValue({})
    renderButton()
    await userEvent.click(screen.getByTitle('resources.addToCampaign'))
    await userEvent.click(await screen.findByText('Curse of Strahd'))

    await waitFor(() =>
      expect(campaigns.addResource).toHaveBeenCalledWith(10, {
        resource_type: 'book',
        resource_id: 5,
        shared: false,
      })
    )
    expect(await screen.findByText('resources.added')).toBeInTheDocument()
  })

  it('does not re-add a campaign that is already marked as added', async () => {
    campaigns.list.mockResolvedValue([owned[0]])
    campaigns.listResources.mockResolvedValue([{ resource_type: 'book', resource_id: 5 }])
    renderButton()
    await userEvent.click(screen.getByTitle('resources.addToCampaign'))
    await userEvent.click(await screen.findByText('Curse of Strahd'))
    expect(campaigns.addResource).not.toHaveBeenCalled()
  })

  it('treats a 409 conflict as already added', async () => {
    campaigns.list.mockResolvedValue([owned[0]])
    const err = new Error('already linked')
    err.status = 409
    campaigns.addResource.mockRejectedValue(err)
    renderButton()
    await userEvent.click(screen.getByTitle('resources.addToCampaign'))
    await userEvent.click(await screen.findByText('Curse of Strahd'))
    expect(await screen.findByText('resources.added')).toBeInTheDocument()
  })

  it('alerts on any other add failure', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    campaigns.list.mockResolvedValue([owned[0]])
    const err = new Error('server exploded')
    err.status = 500
    campaigns.addResource.mockRejectedValue(err)
    renderButton()
    await userEvent.click(screen.getByTitle('resources.addToCampaign'))
    await userEvent.click(await screen.findByText('Curse of Strahd'))

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('server exploded'))
    expect(screen.queryByText('resources.added')).not.toBeInTheDocument()
    alertSpy.mockRestore()
  })

  it('closes the menu when the backdrop is clicked', async () => {
    campaigns.list.mockResolvedValue(owned)
    const { container } = renderButton()
    await userEvent.click(screen.getByTitle('resources.addToCampaign'))
    await screen.findByText('Curse of Strahd')

    // The backdrop is the first fixed, full-inset overlay div.
    const backdrop = container.querySelector('div[style*="z-index: 9998"]')
    await userEvent.click(backdrop)
    expect(screen.queryByText('Curse of Strahd')).not.toBeInTheDocument()
  })

  it('positions the menu below the trigger', async () => {
    campaigns.list.mockResolvedValue(owned)
    const { container } = renderButton()
    const trigger = screen.getByTitle('resources.addToCampaign')
    trigger.getBoundingClientRect = () => ({ bottom: 100, left: 40 })

    await userEvent.click(trigger)
    await screen.findByText('Curse of Strahd')
    const menu = container.querySelector('div[style*="z-index: 9999"]')
    expect(menu).toHaveStyle({ top: '104px', left: '40px' })
  })
})
