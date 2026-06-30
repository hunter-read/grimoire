import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import AvailabilityChart from './AvailabilityChart'

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

// Open a row's editable cell menu and pick a status. The chart renders one
// status-picker button per editable cell, in row order.
function pickStatusForCell(cellIndex, label) {
  const buttons = screen.getAllByTitle((_, el) =>
    ['Available', 'Set availability'].includes(el?.getAttribute('title'))
  )
  fireEvent.click(buttons[cellIndex])
  // The status options render as <button>; the legend renders the same labels
  // as <span>, so scope to the picker menu by role.
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('AvailabilityChart', () => {
  it("threads the player's user_id when the GM edits a player row", () => {
    const onSetAvailability = vi.fn()
    render(
      <AvailabilityChart
        availability={availability}
        userId="gm1"
        isOwner={true}
        onSetAvailability={onSetAvailability}
        onCancelDate={vi.fn()}
      />
    )

    // Cell index 1 is the player's row (index 0 is the GM's own row).
    pickStatusForCell(1, 'Unavailable')

    expect(onSetAvailability).toHaveBeenCalledWith('2026-07-01', 'unavailable', 'player1')
  })

  it("passes the GM's own user_id when the GM edits their own row", () => {
    const onSetAvailability = vi.fn()
    render(
      <AvailabilityChart
        availability={availability}
        userId="gm1"
        isOwner={true}
        onSetAvailability={onSetAvailability}
        onCancelDate={vi.fn()}
      />
    )

    pickStatusForCell(0, 'Tentative')

    expect(onSetAvailability).toHaveBeenCalledWith('2026-07-01', 'tentative', 'gm1')
  })

  it('renders a player as a read-only icon/dash for a non-owner viewer', () => {
    const onSetAvailability = vi.fn()
    render(
      <AvailabilityChart
        availability={availability}
        userId="player1"
        isOwner={false}
        onSetAvailability={onSetAvailability}
        onCancelDate={vi.fn()}
      />
    )

    // A non-owner sees their own row editable and other rows read-only. The
    // GM row (status 'available') renders as a status icon, not a button.
    const gmRow = screen.getByText('Gandalf').closest('tr')
    expect(within(gmRow).queryByRole('button')).toBeNull()

    // The "(you)" badge shows on the viewer's own non-owner row.
    expect(screen.getByText('(you)')).toBeTruthy()
  })

  it('shows an em-dash for a read-only cell with no status', () => {
    const noStatus = {
      next_sessions: ['2026-07-01'],
      cancelled_dates: [],
      rows: [
        {
          user_id: 'gm1',
          username: 'Gandalf',
          is_owner: true,
          dates: { '2026-07-01': { status: null, is_cancelled: false } },
        },
        {
          user_id: 'player1',
          username: 'Frodo',
          is_owner: false,
          dates: { '2026-07-01': { status: null, is_cancelled: false } },
        },
      ],
    }
    // Viewer is the player; the GM's row is read-only with no status → em-dash.
    const { container } = render(
      <AvailabilityChart
        availability={noStatus}
        userId="player1"
        isOwner={false}
        onSetAvailability={vi.fn()}
        onCancelDate={vi.fn()}
      />
    )
    expect(container.textContent).toContain('—')
  })

  it('shows the uncancel control on a cancelled date for the GM', () => {
    const onCancelDate = vi.fn()
    const cancelled = {
      next_sessions: ['2026-07-01'],
      cancelled_dates: ['2026-07-01'],
      rows: [
        {
          user_id: 'gm1',
          username: 'Gandalf',
          is_owner: true,
          dates: { '2026-07-01': { status: 'available', is_cancelled: true } },
        },
      ],
    }
    render(
      <AvailabilityChart
        availability={cancelled}
        userId="gm1"
        isOwner={true}
        onSetAvailability={vi.fn()}
        onCancelDate={onCancelDate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Un-cancel session' }))
    expect(onCancelDate).toHaveBeenCalledWith('2026-07-01')
  })

  it('returns null when there are no upcoming sessions', () => {
    const { container } = render(
      <AvailabilityChart
        availability={{ next_sessions: [], cancelled_dates: [], rows: [] }}
        userId="gm1"
        isOwner={true}
        onSetAvailability={vi.fn()}
        onCancelDate={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})
