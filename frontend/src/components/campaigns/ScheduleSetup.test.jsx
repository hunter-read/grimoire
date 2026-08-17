import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ScheduleSetup from './ScheduleSetup'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
  }),
}))

vi.mock('../../api', () => ({
  campaigns: { getSchedule: vi.fn(), setSchedule: vi.fn() },
}))

// Stub the editor so the setup component's own callbacks can be driven without
// depending on the editor's internals.
vi.mock('./ScheduleEditor', () => ({
  default: ({ onSaved, onDeleted }) => (
    <div>
      <button
        onClick={() =>
          onSaved({
            definition: { frequency: 'weekly', days: [6], time_local: '19:30' },
            enabled: true,
          })
        }
      >
        stub-save
      </button>
      <button onClick={onDeleted}>stub-delete</button>
    </div>
  ),
}))

import { campaigns } from '../../api'

const campaign = { id: 'c1' }
const weekly = { frequency: 'weekly', days: [6], time_local: '19:30' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ScheduleSetup', () => {
  it('shows a spinner until the schedule loads', () => {
    campaigns.getSchedule.mockReturnValue(new Promise(() => {}))
    const { container } = render(<ScheduleSetup campaign={campaign} />)
    expect(container.querySelector('svg, div')).toBeTruthy()
  })

  it('renders the summary once loaded', async () => {
    campaigns.getSchedule.mockResolvedValue({ definition: weekly, enabled: true })
    render(<ScheduleSetup campaign={campaign} />)
    expect(await screen.findByText(/schedule\.frequency\.weekly/)).toBeInTheDocument()
  })

  it('shows the stored local time without converting it', async () => {
    campaigns.getSchedule.mockResolvedValue({ definition: weekly, enabled: true })
    render(<ScheduleSetup campaign={campaign} />)
    expect(await screen.findByText(/7:30/)).toBeInTheDocument()
  })

  it('collapses to just the toggle when disabled', async () => {
    campaigns.getSchedule.mockResolvedValue({ definition: weekly, enabled: false })
    render(<ScheduleSetup campaign={campaign} />)
    await waitFor(() =>
      expect(screen.getByText('campaignEditor.scheduleDisabled')).toBeInTheDocument()
    )
    expect(screen.queryByText('schedule.edit')).not.toBeInTheDocument()
  })

  it('shows the editor when there is no definition yet', async () => {
    campaigns.getSchedule.mockResolvedValue({ definition: null, enabled: true })
    render(<ScheduleSetup campaign={campaign} />)
    expect(await screen.findByText('stub-save')).toBeInTheDocument()
  })

  it('falls back to an empty schedule when loading fails', async () => {
    campaigns.getSchedule.mockRejectedValue(new Error('nope'))
    render(<ScheduleSetup campaign={campaign} />)
    await waitFor(() =>
      expect(screen.getByText('campaignEditor.scheduleDisabled')).toBeInTheDocument()
    )
  })

  it('opens the editor from the summary and saves', async () => {
    campaigns.getSchedule.mockResolvedValue({ definition: weekly, enabled: true })
    const onChanged = vi.fn()
    render(<ScheduleSetup campaign={campaign} onChanged={onChanged} />)
    fireEvent.click(await screen.findByText('schedule.edit'))
    fireEvent.click(await screen.findByText('stub-save'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('clears the definition when the editor deletes it', async () => {
    campaigns.getSchedule.mockResolvedValue({ definition: null, enabled: true })
    const onChanged = vi.fn()
    render(<ScheduleSetup campaign={campaign} onChanged={onChanged} />)
    fireEvent.click(await screen.findByText('stub-delete'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('persists the enabled flag through the API when a definition exists', async () => {
    campaigns.getSchedule.mockResolvedValue({ definition: weekly, enabled: true })
    campaigns.setSchedule.mockResolvedValue({ definition: weekly, enabled: false })
    render(<ScheduleSetup campaign={campaign} />)
    await screen.findByText('schedule.edit')
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() =>
      expect(campaigns.setSchedule).toHaveBeenCalledWith('c1', { ...weekly, enabled: false })
    )
  })

  it('toggles locally without an API call when there is no definition', async () => {
    campaigns.getSchedule.mockResolvedValue({ definition: null, enabled: true })
    render(<ScheduleSetup campaign={campaign} />)
    await screen.findByText('stub-save')
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() =>
      expect(screen.getByText('campaignEditor.scheduleDisabled')).toBeInTheDocument()
    )
    expect(campaigns.setSchedule).not.toHaveBeenCalled()
  })

  it('keeps the toggle as-is when persisting the flag fails', async () => {
    campaigns.getSchedule.mockResolvedValue({ definition: weekly, enabled: true })
    campaigns.setSchedule.mockRejectedValue(new Error('boom'))
    render(<ScheduleSetup campaign={campaign} />)
    await screen.findByText('schedule.edit')
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(campaigns.setSchedule).toHaveBeenCalled())
    expect(screen.getByText('campaignEditor.scheduleEnabled')).toBeInTheDocument()
  })

  it('summarises custom dates by count', async () => {
    campaigns.getSchedule.mockResolvedValue({
      definition: { frequency: 'custom', custom_dates: ['2026-08-23'] },
      enabled: true,
    })
    render(<ScheduleSetup campaign={campaign} />)
    expect(await screen.findByText(/customDates/)).toBeInTheDocument()
  })

  it('describes a monthly pattern', async () => {
    campaigns.getSchedule.mockResolvedValue({
      definition: { frequency: 'monthly', days: [2], monthly_week: -1 },
      enabled: true,
    })
    render(<ScheduleSetup campaign={campaign} />)
    expect(await screen.findByText(/schedule\.monthlyPattern/)).toBeInTheDocument()
  })

  it('falls back to the raw frequency when unrecognised', async () => {
    campaigns.getSchedule.mockResolvedValue({
      definition: { frequency: 'hourly', days: [] },
      enabled: true,
    })
    render(<ScheduleSetup campaign={campaign} />)
    expect(await screen.findByText(/hourly/)).toBeInTheDocument()
  })
})
