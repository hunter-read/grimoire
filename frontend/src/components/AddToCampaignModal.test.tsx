import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddToCampaignModal, { type AddToCampaignItem } from './AddToCampaignModal'
import { campaigns } from '../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('./Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

let mockUser: { id: number; username: string } | null = { id: 7, username: 'gm' }
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

vi.mock('../api', () => ({
  campaigns: { list: vi.fn(), bulkAddResources: vi.fn() },
}))

// Numeric ids, as the fixtures always had: the modal passes them through untouched.
const items = [
  { resource_type: 'book', resource_id: 1 },
  { resource_type: 'book', resource_id: 2 },
] as unknown as AddToCampaignItem[]

// The fixtures are partial campaigns, so the mocks are driven untyped.
const listMock = campaigns.list as unknown as Mock
const bulkAddMock = campaigns.bulkAddResources as unknown as Mock

const myCampaigns = [
  { id: 10, name: 'Curse of Strahd', owner_id: 7, locked: false },
  { id: 11, name: 'Avernus', owner_id: 7, locked: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockUser = { id: 7, username: 'gm' }
})

describe('AddToCampaignModal', () => {
  it('shows a spinner while the campaign list loads', () => {
    listMock.mockReturnValue(new Promise(() => {}))
    render(<AddToCampaignModal items={items} onClose={vi.fn()} onAdded={vi.fn()} />)
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
    expect(screen.getByText('bulk.addToCampaign')).toBeInTheDocument()
  })

  it('lists only campaigns the user owns and that are unlocked', async () => {
    listMock.mockResolvedValue([
      ...myCampaigns,
      { id: 12, name: 'Someone Elses', owner_id: 99, locked: false },
      { id: 13, name: 'Locked Game', owner_id: 7, locked: true },
    ])
    render(<AddToCampaignModal items={items} onClose={vi.fn()} onAdded={vi.fn()} />)

    expect(await screen.findByText('Curse of Strahd')).toBeInTheDocument()
    expect(screen.getByText('Avernus')).toBeInTheDocument()
    expect(screen.queryByText('Someone Elses')).not.toBeInTheDocument()
    expect(screen.queryByText('Locked Game')).not.toBeInTheDocument()
  })

  it('preselects the first owned campaign', async () => {
    listMock.mockResolvedValue(myCampaigns)
    render(<AddToCampaignModal items={items} onClose={vi.fn()} onAdded={vi.fn()} />)
    await screen.findByText('Curse of Strahd')
    const selects = screen.getAllByRole<HTMLSelectElement>('combobox')
    expect(selects[0].value).toBe('10')
    expect(selects[1].value).toBe('public')
  })

  it('shows the empty state and disables the add button with no campaigns', async () => {
    listMock.mockResolvedValue([])
    render(<AddToCampaignModal items={items} onClose={vi.fn()} onAdded={vi.fn()} />)
    expect(await screen.findByText('addToCampaign.noCampaigns')).toBeInTheDocument()
    expect(screen.getByText('addToCampaign.add').closest('button')).toBeDisabled()
  })

  it('falls back to an empty list when loading fails', async () => {
    listMock.mockRejectedValue(new Error('offline'))
    render(<AddToCampaignModal items={items} onClose={vi.fn()} onAdded={vi.fn()} />)
    expect(await screen.findByText('addToCampaign.noCampaigns')).toBeInTheDocument()
  })

  it('tolerates a null response from the API', async () => {
    listMock.mockResolvedValue(null)
    render(<AddToCampaignModal items={items} onClose={vi.fn()} onAdded={vi.fn()} />)
    expect(await screen.findByText('addToCampaign.noCampaigns')).toBeInTheDocument()
  })

  it('bulk-adds the items with the chosen campaign and visibility', async () => {
    listMock.mockResolvedValue(myCampaigns)
    bulkAddMock.mockResolvedValue([{ id: 1 }])
    const onAdded = vi.fn()
    render(<AddToCampaignModal items={items} onClose={vi.fn()} onAdded={onAdded} />)
    await screen.findByText('Curse of Strahd')

    const [campaignSelect, visibilitySelect] = screen.getAllByRole('combobox')
    await userEvent.selectOptions(campaignSelect, '11')
    await userEvent.selectOptions(visibilitySelect, 'gm')
    await userEvent.click(screen.getByText('addToCampaign.add'))

    await waitFor(() =>
      expect(campaigns.bulkAddResources).toHaveBeenCalledWith('11', [
        { resource_type: 'book', resource_id: 1, visibility: 'gm' },
        { resource_type: 'book', resource_id: 2, visibility: 'gm' },
      ])
    )
    expect(onAdded).toHaveBeenCalledWith([{ id: 1 }])
  })

  it('shows the applying label while saving', async () => {
    listMock.mockResolvedValue(myCampaigns)
    bulkAddMock.mockReturnValue(new Promise(() => {}))
    render(<AddToCampaignModal items={items} onClose={vi.fn()} onAdded={vi.fn()} />)
    await screen.findByText('Curse of Strahd')

    await userEvent.click(screen.getByText('addToCampaign.add'))
    expect(await screen.findByText('bulk.applying')).toBeInTheDocument()
  })

  it('surfaces an error and re-enables the button when the add fails', async () => {
    listMock.mockResolvedValue(myCampaigns)
    bulkAddMock.mockRejectedValue(new Error('conflict'))
    const onAdded = vi.fn()
    render(<AddToCampaignModal items={items} onClose={vi.fn()} onAdded={onAdded} />)
    await screen.findByText('Curse of Strahd')

    await userEvent.click(screen.getByText('addToCampaign.add'))
    expect(await screen.findByText('conflict')).toBeInTheDocument()
    expect(onAdded).not.toHaveBeenCalled()
    expect(screen.getByText('addToCampaign.add')).toBeInTheDocument()
  })

  it('does nothing when submitting without a selected campaign', async () => {
    listMock.mockResolvedValue([])
    render(<AddToCampaignModal items={items} onClose={vi.fn()} onAdded={vi.fn()} />)
    await screen.findByText('addToCampaign.noCampaigns')

    await userEvent.click(screen.getByText('addToCampaign.add'))
    expect(campaigns.bulkAddResources).not.toHaveBeenCalled()
  })

  it('closes via the close button, the cancel button, and the overlay', async () => {
    listMock.mockResolvedValue(myCampaigns)
    const onClose = vi.fn()
    render(<AddToCampaignModal items={items} onClose={onClose} onAdded={vi.fn()} />)
    await screen.findByText('Curse of Strahd')

    await userEvent.click(screen.getByLabelText('common.close'))
    await userEvent.click(screen.getByText('common.cancel'))
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('does not close when a click lands inside the panel', async () => {
    listMock.mockResolvedValue(myCampaigns)
    const onClose = vi.fn()
    render(<AddToCampaignModal items={items} onClose={onClose} onAdded={vi.fn()} />)
    await userEvent.click(await screen.findByText('addToCampaign.intro'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('treats an anonymous user as owning nothing', async () => {
    mockUser = null
    listMock.mockResolvedValue(myCampaigns)
    render(<AddToCampaignModal items={items} onClose={vi.fn()} onAdded={vi.fn()} />)
    expect(await screen.findByText('addToCampaign.noCampaigns')).toBeInTheDocument()
  })
})
