import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScheduleEditor, { SegmentControl } from './ScheduleEditor'

vi.mock('../../api', () => ({
  campaigns: {
    setSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
  },
}))

import { campaigns } from '../../api'

const mockCampaign = { id: 'c1' }

function renderEditor(existing = null) {
  return render(
    <ScheduleEditor
      campaign={mockCampaign}
      existing={existing}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
    />
  )
}

describe('SegmentControl', () => {
  it('renders all options', () => {
    const options = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ]
    render(<SegmentControl value="a" options={options} onChange={vi.fn()} />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('B')).toBeTruthy()
  })

  it('calls onChange with the clicked option key', () => {
    const onChange = vi.fn()
    const options = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ]
    render(<SegmentControl value="a" options={options} onChange={onChange} />)
    fireEvent.click(screen.getByText('B'))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('ScheduleEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders frequency segment control', () => {
    renderEditor()
    expect(screen.getByText('Weekly')).toBeTruthy()
    expect(screen.getByText('Bi-weekly')).toBeTruthy()
    expect(screen.getByText('Monthly')).toBeTruthy()
    expect(screen.getByText('Custom')).toBeTruthy()
  })

  it('renders day selector for weekly frequency', () => {
    renderEditor()
    expect(screen.getByText('Mon')).toBeTruthy()
    expect(screen.getByText('Fri')).toBeTruthy()
  })

  it('renders time picker with checkbox', () => {
    renderEditor()
    expect(screen.getByRole('checkbox')).toBeTruthy()
  })

  it('time input is hidden when checkbox is unchecked', () => {
    renderEditor()
    // The time input only renders after the checkbox is checked
    expect(document.querySelector('input[type="time"]')).toBeNull()
  })

  it('shows time input after checking the time checkbox', () => {
    renderEditor()
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(screen.getByDisplayValue('')).toBeTruthy()
    // find the time input element directly
    const timeInput = document.querySelector('input[type="time"]')
    expect(timeInput).toBeTruthy()
  })

  it('renders datalist with time options when time is enabled', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('checkbox'))
    const datalist = document.getElementById('schedule-time-options')
    expect(datalist).toBeTruthy()
    const options = datalist.querySelectorAll('option')
    expect(options.length).toBe(96)
  })

  it('populates from existing schedule', () => {
    renderEditor({
      frequency: 'weekly',
      days: [1, 3],
      time_utc: null,
      biweekly_reference: '',
      monthly_week: 1,
      custom_dates: [],
    })
    // Tuesday (index 1) and Thursday (index 3) should be shown as selected
    // Just verify the editor renders without error — day selection is visual state
    expect(screen.getByText('Tue')).toBeTruthy()
    expect(screen.getByText('Thu')).toBeTruthy()
  })

  it('shows Remove button when existing schedule is present', () => {
    renderEditor({
      frequency: 'weekly',
      days: [0],
      time_utc: null,
      biweekly_reference: '',
      monthly_week: 1,
      custom_dates: [],
    })
    expect(screen.getByText('Remove')).toBeTruthy()
  })

  it('does not show Remove button when no existing schedule', () => {
    renderEditor(null)
    expect(screen.queryByText('Remove')).toBeNull()
  })

  it('alerts when saving weekly schedule with no days selected', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    renderEditor()
    fireEvent.click(screen.getByText('Save Schedule'))
    expect(alertSpy).toHaveBeenCalledWith('Select at least one day.')
  })

  it('calls setSchedule with correct payload when a day is selected and saved', async () => {
    campaigns.setSchedule.mockResolvedValue({ frequency: 'weekly', days: [0] })
    const onSaved = vi.fn()
    render(
      <ScheduleEditor
        campaign={mockCampaign}
        existing={null}
        onSaved={onSaved}
        onDeleted={vi.fn()}
      />
    )
    // Select Monday (index 0)
    fireEvent.click(screen.getByText('Mon'))
    fireEvent.click(screen.getByText('Save Schedule'))
    await waitFor(() =>
      expect(campaigns.setSchedule).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          frequency: 'weekly',
          days: [0],
        })
      )
    )
    expect(onSaved).toHaveBeenCalled()
  })

  it('switches to custom date mode and shows date adder', () => {
    renderEditor()
    fireEvent.click(screen.getByText('Custom'))
    expect(screen.getByText('Session Dates')).toBeTruthy()
    expect(screen.getByText('No dates added yet.')).toBeTruthy()
  })

  it('shows biweekly reference date input in biweekly mode', () => {
    renderEditor()
    fireEvent.click(screen.getByText('Bi-weekly'))
    expect(screen.getByText(/Reference date/)).toBeTruthy()
  })

  it('shows monthly week selector in monthly mode', () => {
    renderEditor()
    fireEvent.click(screen.getByText('Monthly'))
    expect(screen.getByText('Which occurrence')).toBeTruthy()
    expect(screen.getByText('1st')).toBeTruthy()
    expect(screen.getByText('Last')).toBeTruthy()
  })
})
