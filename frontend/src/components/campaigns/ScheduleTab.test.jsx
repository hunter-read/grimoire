import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ScheduleTab from './ScheduleTab'

vi.mock('../../api', () => ({
  campaigns: {
    getSchedule: vi.fn(),
    getAvailability: vi.fn(),
    setAvailability: vi.fn(),
    cancelDate: vi.fn(),
    setSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
  },
}))

// Stub the editor/summary children so we can drive ScheduleTab's callbacks
// (onSaved/onDeleted/onEdit) directly without depending on their internals.
vi.mock('./ScheduleEditor', () => ({
  default: ({ onSaved, onDeleted }) => (
    <div>
      <button
        onClick={() =>
          onSaved({
            definition: { days: [2], frequency: 'weekly', time_utc: '19:00' },
            enabled: true,
            next_sessions: ['2026-07-08'],
          })
        }
      >
        mock-save
      </button>
      <button onClick={() => onDeleted()}>mock-delete</button>
    </div>
  ),
}))

vi.mock('./ScheduleSummary', () => ({
  default: ({ onEdit }) => <button onClick={onEdit}>mock-edit</button>,
}))

import { campaigns } from '../../api'

const campaign = { id: 'c1' }

const scheduleData = {
  definition: { days: [1], frequency: 'weekly', time_utc: '18:00' },
  enabled: true,
  next_sessions: ['2026-07-01'],
}

const availability = {
  next_sessions: ['2026-07-01'],
  cancelled_dates: [],
  rows: [
    {
      user_id: 'gm1',
      username: 'Gandalf',
      is_owner: true,
      dates: { '2026-07-01': { status: 'available', is_cancelled: false } },
    },
    {
      user_id: 'player1',
      username: 'Frodo',
      is_owner: false,
      dates: { '2026-07-01': { status: null, is_cancelled: false } },
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  campaigns.getSchedule.mockResolvedValue(scheduleData)
  campaigns.getAvailability.mockResolvedValue(availability)
  campaigns.setAvailability.mockResolvedValue({})
  campaigns.cancelDate.mockResolvedValue({})
})

function clickStatusForCell(cellIndex, label) {
  const buttons = screen.getAllByTitle((_, el) =>
    ['Available', 'Set availability'].includes(el?.getAttribute('title'))
  )
  fireEvent.click(buttons[cellIndex])
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('ScheduleTab handleSetAvailability', () => {
  it("sends user_id when the GM edits another member's row", async () => {
    render(<ScheduleTab campaign={campaign} isOwner={true} userId="gm1" />)
    await waitFor(() => expect(screen.getByText('Frodo')).toBeTruthy())

    clickStatusForCell(1, 'Unavailable')

    await waitFor(() =>
      expect(campaigns.setAvailability).toHaveBeenCalledWith('c1', '2026-07-01', {
        status: 'unavailable',
        user_id: 'player1',
      })
    )
  })

  it('omits user_id when the GM edits their own row', async () => {
    render(<ScheduleTab campaign={campaign} isOwner={true} userId="gm1" />)
    await waitFor(() => expect(screen.getByText('Gandalf')).toBeTruthy())

    clickStatusForCell(0, 'Tentative')

    await waitFor(() =>
      expect(campaigns.setAvailability).toHaveBeenCalledWith('c1', '2026-07-01', {
        status: 'tentative',
      })
    )
  })

  it('reloads availability after a change', async () => {
    render(<ScheduleTab campaign={campaign} isOwner={true} userId="gm1" />)
    await waitFor(() => expect(screen.getByText('Frodo')).toBeTruthy())
    campaigns.getAvailability.mockClear()

    clickStatusForCell(1, 'Unavailable')

    await waitFor(() => expect(campaigns.getAvailability).toHaveBeenCalledWith('c1'))
  })

  it('cancels a date through the GM cell menu', async () => {
    render(<ScheduleTab campaign={campaign} isOwner={true} userId="gm1" />)
    await waitFor(() => expect(screen.getByText('Gandalf')).toBeTruthy())

    // Open the GM's own cell menu (cell 0) and pick the cancel-session action.
    const buttons = screen.getAllByTitle((_, el) =>
      ['Available', 'Set availability'].includes(el?.getAttribute('title'))
    )
    fireEvent.click(buttons[0])
    fireEvent.click(screen.getByRole('button', { name: /Cancel session/i }))

    await waitFor(() => expect(campaigns.cancelDate).toHaveBeenCalledWith('c1', '2026-07-01'))
  })

  it('renders the schedule editor when no schedule is defined', async () => {
    campaigns.getSchedule.mockResolvedValue({ definition: null, enabled: false, next_sessions: [] })
    campaigns.getAvailability.mockResolvedValue({
      next_sessions: [],
      cancelled_dates: [],
      rows: [],
    })
    render(<ScheduleTab campaign={campaign} isOwner={true} userId="gm1" />)

    // With no definition, the (mocked) editor renders instead of the summary.
    await waitFor(() => expect(screen.getByText('mock-save')).toBeTruthy())
    expect(screen.queryByText('mock-edit')).toBeNull()
  })

  it('switches to the editor from the summary and saves a new schedule', async () => {
    render(<ScheduleTab campaign={campaign} isOwner={true} userId="gm1" />)
    await waitFor(() => expect(screen.getByText('mock-edit')).toBeTruthy())

    // Summary → Edit shows the editor.
    fireEvent.click(screen.getByText('mock-edit'))
    expect(screen.getByText('mock-save')).toBeTruthy()

    // Saving applies the result, closes the editor, and reloads availability.
    campaigns.getAvailability.mockClear()
    fireEvent.click(screen.getByText('mock-save'))
    await waitFor(() => expect(screen.getByText('mock-edit')).toBeTruthy())
    expect(campaigns.getAvailability).toHaveBeenCalledWith('c1')
  })

  it('clears the schedule when the editor reports a deletion', async () => {
    campaigns.getSchedule.mockResolvedValue({ definition: null, enabled: false, next_sessions: [] })
    campaigns.getAvailability.mockResolvedValue({
      next_sessions: [],
      cancelled_dates: [],
      rows: [],
    })
    render(<ScheduleTab campaign={campaign} isOwner={true} userId="gm1" />)
    await waitFor(() => expect(screen.getByText('mock-delete')).toBeTruthy())

    campaigns.getAvailability.mockClear()
    fireEvent.click(screen.getByText('mock-delete'))

    // After deletion the empty-state prompt appears and availability reloads.
    await waitFor(() =>
      expect(screen.getByText('No schedule defined yet. Set one above.')).toBeTruthy()
    )
    expect(campaigns.getAvailability).toHaveBeenCalledWith('c1')
  })
})
