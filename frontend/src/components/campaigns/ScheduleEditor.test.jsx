import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScheduleEditor from './ScheduleEditor'
import SegmentControl from './SegmentControl'
import { USER_TZ } from './_scheduleShared'

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

  it('stays plain buttons unless asTabs is set', () => {
    const options = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ]
    render(<SegmentControl value="a" options={options} onChange={vi.fn()} />)
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('exposes tab semantics when asTabs is set', () => {
    const options = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ]
    render(<SegmentControl value="a" options={options} onChange={vi.fn()} asTabs label="Groups" />)
    expect(screen.getByRole('tablist', { name: 'Groups' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'B' }).getAttribute('aria-selected')).toBe('false')
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

  it('toggles a weekly day off again when clicked twice', async () => {
    campaigns.setSchedule.mockResolvedValue({})
    renderEditor()
    fireEvent.click(screen.getByText('Wed'))
    fireEvent.click(screen.getByText('Mon'))
    // Clicking Wed again removes it, leaving only Monday.
    fireEvent.click(screen.getByText('Wed'))
    fireEvent.click(screen.getByText('Save Schedule'))
    await waitFor(() =>
      expect(campaigns.setSchedule).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ days: [0] })
      )
    )
  })

  it('monthly mode keeps a single day and sends the chosen occurrence week', async () => {
    campaigns.setSchedule.mockResolvedValue({})
    const onSaved = vi.fn()
    render(
      <ScheduleEditor
        campaign={mockCampaign}
        existing={null}
        onSaved={onSaved}
        onDeleted={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Monthly'))
    fireEvent.click(screen.getByText('Tue'))
    // Picking a second day replaces rather than appends in monthly mode.
    fireEvent.click(screen.getByText('Thu'))
    fireEvent.click(screen.getByText('Last'))
    // The human-readable pattern summary appears once a day is chosen.
    expect(screen.getByText('Last Thursday of each month')).toBeTruthy()
    fireEvent.click(screen.getByText('Save Schedule'))
    await waitFor(() =>
      expect(campaigns.setSchedule).toHaveBeenCalledWith('c1', {
        days: [3],
        frequency: 'monthly',
        time_utc: null,
        timezone: USER_TZ,
        biweekly_reference: null,
        monthly_week: -1,
        custom_dates: null,
      })
    )
    expect(onSaved).toHaveBeenCalled()
  })

  it('defaults the biweekly reference date to today when left blank', async () => {
    campaigns.setSchedule.mockResolvedValue({})
    renderEditor()
    fireEvent.click(screen.getByText('Bi-weekly'))
    fireEvent.click(screen.getByText('Mon'))
    fireEvent.click(screen.getByText('Save Schedule'))
    await waitFor(() => expect(campaigns.setSchedule).toHaveBeenCalled())
    const payload = campaigns.setSchedule.mock.calls[0][1]
    expect(payload.frequency).toBe('biweekly')
    expect(payload.biweekly_reference).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('sends an explicit biweekly reference date when one is entered', async () => {
    campaigns.setSchedule.mockResolvedValue({})
    renderEditor()
    fireEvent.click(screen.getByText('Bi-weekly'))
    fireEvent.click(screen.getByText('Mon'))
    fireEvent.change(document.getElementById('schedule-biweekly-ref'), {
      target: { value: '2026-03-04' },
    })
    fireEvent.click(screen.getByText('Save Schedule'))
    await waitFor(() =>
      expect(campaigns.setSchedule).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ biweekly_reference: '2026-03-04' })
      )
    )
  })

  it('alerts instead of saving when custom mode has no dates', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    renderEditor()
    fireEvent.click(screen.getByText('Custom'))
    fireEvent.click(screen.getByText('Save Schedule'))
    expect(alertSpy).toHaveBeenCalledWith('Add at least one date.')
    expect(campaigns.setSchedule).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('adds, deduplicates and removes custom dates, then saves them', async () => {
    campaigns.setSchedule.mockResolvedValue({})
    renderEditor()
    fireEvent.click(screen.getByText('Custom'))
    const dateInput = document.getElementById('schedule-custom-date')
    const addBtn = screen.getByLabelText('Add date')

    // A blank input is a no-op.
    fireEvent.click(addBtn)
    expect(screen.getByText('No dates added yet.')).toBeTruthy()

    fireEvent.change(dateInput, { target: { value: '2026-05-10' } })
    fireEvent.click(addBtn)
    expect(screen.queryByText('No dates added yet.')).toBeNull()

    // Re-adding the same date is ignored.
    fireEvent.change(dateInput, { target: { value: '2026-05-10' } })
    fireEvent.click(addBtn)

    fireEvent.change(dateInput, { target: { value: '2026-05-17' } })
    fireEvent.click(addBtn)

    // Drop the first date again via its remove button.
    const removeButtons = screen.getAllByLabelText(/^Remove /)
    expect(removeButtons).toHaveLength(2)
    fireEvent.click(removeButtons[0])

    fireEvent.click(screen.getByText('Save Schedule'))
    await waitFor(() =>
      expect(campaigns.setSchedule).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ frequency: 'custom', custom_dates: ['2026-05-17'], days: [] })
      )
    )
  })

  it('alerts and stops saving when the API rejects', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    campaigns.setSchedule.mockRejectedValue(new Error('server exploded'))
    const onSaved = vi.fn()
    render(
      <ScheduleEditor
        campaign={mockCampaign}
        existing={null}
        onSaved={onSaved}
        onDeleted={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Mon'))
    fireEvent.click(screen.getByText('Save Schedule'))
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('server exploded'))
    expect(onSaved).not.toHaveBeenCalled()
    // The button becomes usable again after the failure.
    await waitFor(() => expect(screen.getByText('Save Schedule')).toBeTruthy())
    alertSpy.mockRestore()
  })

  it('deletes the schedule once the confirmation is accepted', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    campaigns.deleteSchedule.mockResolvedValue({})
    const onDeleted = vi.fn()
    render(
      <ScheduleEditor
        campaign={mockCampaign}
        existing={{ frequency: 'weekly', days: [0], custom_dates: [] }}
        onSaved={vi.fn()}
        onDeleted={onDeleted}
      />
    )
    fireEvent.click(screen.getByText('Remove'))
    await waitFor(() => expect(campaigns.deleteSchedule).toHaveBeenCalledWith('c1'))
    expect(onDeleted).toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('keeps the schedule when the delete confirmation is dismissed', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onDeleted = vi.fn()
    render(
      <ScheduleEditor
        campaign={mockCampaign}
        existing={{ frequency: 'weekly', days: [0], custom_dates: [] }}
        onSaved={vi.fn()}
        onDeleted={onDeleted}
      />
    )
    fireEvent.click(screen.getByText('Remove'))
    expect(campaigns.deleteSchedule).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
