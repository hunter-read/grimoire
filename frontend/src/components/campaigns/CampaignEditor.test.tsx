import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CampaignEditor from './CampaignEditor'
import api, { campaigns } from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn() },
  campaigns: {
    create: vi.fn(),
    update: vi.fn(),
    uploadBanner: vi.fn(),
  },
}))

vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: (type, id) => id === 'sys-fav' }),
}))

vi.mock('./ScheduleSetup', () => ({
  default: () => <div data-testid="schedule-setup" />,
}))

// Stand-in picker: exposes a button that selects one book so the create
// payload carries a resource, and echoes the systemId/pinSystem it received.
vi.mock('./ResourcePicker', () => ({
  default: ({ systemId, setSelected, preselectCore, pinSystem }) => (
    <div data-testid="resource-picker">
      <span>{`sys:${systemId}`}</span>
      <span>{`pin:${pinSystem}`}</span>
      <span>{`preselect:${String(preselectCore)}`}</span>
      <button
        onClick={() =>
          setSelected([
            { resource_type: 'book', resource_id: 'b1', name: 'PHB', visibility: 'public' },
          ])
        }
      >
        pick-book
      </button>
    </div>
  ),
}))

const systems = [
  { id: 'sys-fav', name: 'Favourite System' },
  { id: 'sys1', name: 'D&D 5e', parent_id: 'sys-dnd' },
  // Containers: folder groupings whose books live on their children. These must
  // not be offered as a campaign's system (issue: parent-system containers).
  { id: 'sys-dnd', name: 'Dungeons & Dragons', container_kind: 'parent' },
  { id: 'sys-opr', name: 'One-Page RPGs', container_kind: 'one-page' },
  { id: 'sys-honey', name: 'Honey Heist', parent_id: 'sys-opr' },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue(systems)
})

describe('CampaignEditor — create flow', () => {
  it('requires a name before advancing to the resource step', async () => {
    render(<CampaignEditor isGmOrAdmin onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/systems?include_children=true'))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/name is required/i)).toBeInTheDocument()
    // Still on the details step (no picker yet).
    expect(screen.queryByTestId('resource-picker')).not.toBeInTheDocument()
  })

  it('steps to the resource picker and creates with the chosen system and resources', async () => {
    campaigns.create.mockResolvedValue({ id: 'c1' })
    const onSaved = vi.fn()
    render(<CampaignEditor isGmOrAdmin onClose={vi.fn()} onSaved={onSaved} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())

    await userEvent.type(screen.getByLabelText(/name/i), 'My Campaign')
    await userEvent.selectOptions(screen.getByLabelText(/system/i), 'sys1')
    await userEvent.click(screen.getByRole('button', { name: /next/i }))

    // On the resource step, the picker gets the selected system (id + name to
    // pin) and preselectCore.
    expect(await screen.findByTestId('resource-picker')).toBeInTheDocument()
    expect(screen.getByText('sys:sys1')).toBeInTheDocument()
    expect(screen.getByText('pin:D&D 5e')).toBeInTheDocument()
    expect(screen.getByText('preselect:true')).toBeInTheDocument()

    await userEvent.click(screen.getByText('pick-book'))
    await userEvent.click(screen.getByRole('button', { name: /create campaign/i }))

    await waitFor(() => expect(campaigns.create).toHaveBeenCalled())
    const payload = campaigns.create.mock.calls[0][0]
    expect(payload.name).toBe('My Campaign')
    expect(payload.system_id).toBe('sys1')
    expect(payload.resources).toEqual([
      { resource_type: 'book', resource_id: 'b1', visibility: 'public' },
    ])
    expect(onSaved).toHaveBeenCalledWith({ id: 'c1' })
  })

  it('offers container children but not the containers themselves', async () => {
    render(<CampaignEditor isGmOrAdmin onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    const select = screen.getByLabelText(/system/i)
    const values = within(select)
      .getAllByRole('option')
      .map((o) => o.value)

    // Children of both container kinds are playable systems and selectable.
    expect(values).toContain('sys1')
    expect(values).toContain('sys-honey')
    // The containers hold no books of their own, so they are not offered.
    expect(values).not.toContain('sys-dnd')
    expect(values).not.toContain('sys-opr')
  })

  it('selects a container child as the campaign system', async () => {
    campaigns.create.mockResolvedValue({ id: 'c3' })
    render(<CampaignEditor isGmOrAdmin onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    await userEvent.type(screen.getByLabelText(/name/i), 'Curse of Strahd')
    await userEvent.selectOptions(screen.getByLabelText(/system/i), 'sys1')
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /create campaign/i }))
    await waitFor(() => expect(campaigns.create).toHaveBeenCalled())
    expect(campaigns.create.mock.calls[0][0].system_id).toBe('sys1')
  })

  it('can go back from the resource step to the details step', async () => {
    render(<CampaignEditor isGmOrAdmin onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    await userEvent.type(screen.getByLabelText(/name/i), 'Back Test')
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await screen.findByTestId('resource-picker')
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.queryByTestId('resource-picker')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/name/i)).toHaveValue('Back Test')
  })

  it('sends a custom free-text system name', async () => {
    campaigns.create.mockResolvedValue({ id: 'c2' })
    render(<CampaignEditor isGmOrAdmin onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    await userEvent.type(screen.getByLabelText(/name/i), 'Homebrew')
    await userEvent.selectOptions(screen.getByLabelText(/system/i), '__custom__')
    const customInput = screen.getByPlaceholderText(/system/i)
    await userEvent.type(customInput, 'My Homebrew System')
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /create campaign/i }))
    await waitFor(() => expect(campaigns.create).toHaveBeenCalled())
    const payload = campaigns.create.mock.calls[0][0]
    expect(payload.system_id).toBeNull()
    expect(payload.system_name).toBe('My Homebrew System')
  })

  it('surfaces a create error and stays open', async () => {
    campaigns.create.mockRejectedValue(new Error('nope'))
    render(<CampaignEditor isGmOrAdmin onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    await userEvent.type(screen.getByLabelText(/name/i), 'Failing')
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /create campaign/i }))
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })
})

describe('CampaignEditor — edit flow', () => {
  const campaign = {
    id: 'c1',
    name: 'Existing',
    description: 'desc',
    is_gm_campaign: true,
    gm_title: 'Dungeon Master',
    system_id: 'sys1',
  }

  it('renders a single-step edit form with the schedule setup for GM campaigns', async () => {
    render(<CampaignEditor campaign={campaign} isGmOrAdmin onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.getByLabelText(/name/i)).toHaveValue('Existing')
    expect(screen.getByTestId('schedule-setup')).toBeInTheDocument()
    // No stepped create UI.
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
  })

  it('saves edits via update and reports the result', async () => {
    campaigns.update.mockResolvedValue({ ...campaign, name: 'Renamed' })
    const onSaved = vi.fn()
    render(<CampaignEditor campaign={campaign} isGmOrAdmin onClose={vi.fn()} onSaved={onSaved} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    const name = screen.getByLabelText(/name/i)
    await userEvent.clear(name)
    await userEvent.type(name, 'Renamed')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(campaigns.update).toHaveBeenCalled())
    expect(campaigns.update.mock.calls[0][1].name).toBe('Renamed')
    expect(onSaved).toHaveBeenCalled()
  })

  it('shows a delete button that calls onDelete', async () => {
    const onDelete = vi.fn()
    render(
      <CampaignEditor
        campaign={campaign}
        isGmOrAdmin
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDelete={onDelete}
      />
    )
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('closes via the X button', async () => {
    const onClose = vi.fn()
    render(<CampaignEditor campaign={campaign} isGmOrAdmin onClose={onClose} onSaved={vi.fn()} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    // The close (X) button is the first button with no accessible text label.
    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[0])
    expect(onClose).toHaveBeenCalled()
  })
})
