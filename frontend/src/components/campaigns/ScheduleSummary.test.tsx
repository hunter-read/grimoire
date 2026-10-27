import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ScheduleSummary from './ScheduleSummary'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
  }),
}))

const weekly = { frequency: 'weekly', days: [6], time_local: '19:30' }

describe('ScheduleSummary', () => {
  it('renders the frequency label and weekday pattern', () => {
    render(<ScheduleSummary def={weekly} />)
    expect(screen.getByText(/schedule\.frequency\.weekly/)).toBeInTheDocument()
    expect(screen.getByText(/schedule\.days\.sunday/)).toBeInTheDocument()
  })

  it('joins multiple weekdays', () => {
    render(<ScheduleSummary def={{ frequency: 'weekly', days: [0, 3] }} />)
    const text = screen.getByText(/schedule\.days\.monday/)
    expect(text.textContent).toContain('schedule.days.thursday')
  })

  it('shows the stored local time without converting it', () => {
    // The displayed hour must match the stored hour — converting through UTC is
    // what published evening games a day early.
    render(<ScheduleSummary def={weekly} />)
    expect(screen.getByText(/7:30/)).toBeInTheDocument()
  })

  it('omits the time row when no time is set', () => {
    render(<ScheduleSummary def={{ frequency: 'weekly', days: [1] }} />)
    expect(screen.queryByText(/:\d{2}\s*(AM|PM)/i)).not.toBeInTheDocument()
  })

  it('summarises custom dates by count', () => {
    render(
      <ScheduleSummary def={{ frequency: 'custom', custom_dates: ['2026-08-23', '2026-08-30'] }} />
    )
    expect(screen.getByText(/2 custom dates/)).toBeInTheDocument()
  })

  it('counts zero custom dates when the list is missing', () => {
    render(<ScheduleSummary def={{ frequency: 'custom' }} />)
    expect(screen.getByText(/0 custom dates/)).toBeInTheDocument()
  })

  it('describes a monthly pattern with its week and day', () => {
    render(<ScheduleSummary def={{ frequency: 'monthly', days: [2], monthly_week: -1 }} />)
    expect(screen.getByText(/schedule\.monthlyPattern/)).toBeInTheDocument()
  })

  it('falls back to the raw frequency when unrecognised', () => {
    render(<ScheduleSummary def={{ frequency: 'hourly', days: [] }} />)
    expect(screen.getByText(/hourly/)).toBeInTheDocument()
  })

  it('shows the edit button to the owner and fires onEdit', () => {
    const onEdit = vi.fn()
    render(<ScheduleSummary def={weekly} isOwner onEdit={onEdit} />)
    fireEvent.click(screen.getByText('schedule.edit'))
    expect(onEdit).toHaveBeenCalled()
  })

  it('hides the edit button from non-owners', () => {
    render(<ScheduleSummary def={weekly} isOwner={false} />)
    expect(screen.queryByText('schedule.edit')).not.toBeInTheDocument()
  })
})
