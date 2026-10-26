import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScheduledRescanSection from './ScheduledRescanSection'
import { settings as settingsApi, type Schema } from '../../api'
import { SettingsDirtyContext } from './settingsDirty'
import { localTimeToUtc } from './rescanTime'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))
vi.mock('../../api', () => ({
  settings: { get: vi.fn(), patch: vi.fn() },
}))

type Settings = Schema<'SettingsResponse'>

const settings = (overrides: Partial<Settings> = {}) =>
  ({
    rescan_schedule_enabled: true,
    rescan_schedule_interval: 'daily',
    rescan_schedule_hour: 2,
    rescan_schedule_minute: 0,
    rescan_schedule_weekday: 0,
    cleanup_on_rescan: false,
    ...overrides,
  }) as Settings

const get = vi.mocked(settingsApi.get)
const patch = vi.mocked(settingsApi.patch)

const renderWithDirty = () => {
  const set = vi.fn()
  const dirty = () => set.mock.calls.filter(([id]) => id === 'scheduled-rescan').at(-1)?.[1]
  const view = render(
    <SettingsDirtyContext.Provider value={{ set }}>
      <ScheduledRescanSection />
    </SettingsDirtyContext.Provider>
  )
  return { ...view, set, dirty }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ScheduledRescanSection', () => {
  it('shows a spinner, then the saved schedule', async () => {
    get.mockResolvedValue(settings() as never)
    render(<ScheduledRescanSection />)
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'maintenance.scheduledRescan.daily' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('maintenance.scheduledRescan.at')).toBeInTheDocument()
    expect(screen.getByLabelText('maintenance.scheduledRescan.alsoRunCleanup')).not.toBeChecked()
    // Daily has no day picker.
    expect(
      screen.queryByRole('button', { name: 'maintenance.scheduledRescan.weekdays.mon' })
    ).toBeNull()
  })

  it('reads a disabled schedule as off, and hides the time and cleanup options', async () => {
    get.mockResolvedValue(
      settings({ rescan_schedule_enabled: false, cleanup_on_rescan: undefined }) as never
    )
    render(<ScheduledRescanSection />)
    expect(
      await screen.findByRole('button', { name: 'maintenance.scheduledRescan.off' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText('maintenance.scheduledRescan.at')).toBeNull()
    expect(screen.queryByLabelText('maintenance.scheduledRescan.alsoRunCleanup')).toBeNull()
  })

  it('still settles when the settings fail to load', async () => {
    get.mockRejectedValue(new Error('down'))
    render(<ScheduledRescanSection />)
    expect(
      await screen.findByRole('button', { name: 'maintenance.scheduledRescan.off' })
    ).toBeInTheDocument()
  })

  it('saves a weekly schedule with its day, time and cleanup choice', async () => {
    get.mockResolvedValue(settings() as never)
    patch.mockImplementation(async (body) => settings(body as Partial<Settings>) as never)
    render(<ScheduledRescanSection />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'maintenance.scheduledRescan.weekly' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'maintenance.scheduledRescan.weekdays.fri' })
    )
    fireEvent.change(screen.getByLabelText('maintenance.scheduledRescan.at'), {
      target: { value: '04:30' },
    })
    fireEvent.click(screen.getByLabelText('maintenance.scheduledRescan.alsoRunCleanup'))
    fireEvent.click(screen.getByRole('button', { name: /saveSchedule/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('maintenance.scheduledRescan.saved')
    const { hour, minute } = localTimeToUtc('04:30')
    expect(patch).toHaveBeenCalledWith({
      rescan_schedule_enabled: true,
      rescan_schedule_interval: 'weekly',
      rescan_schedule_hour: hour,
      rescan_schedule_minute: minute,
      rescan_schedule_weekday: 4,
      cleanup_on_rescan: true,
    })
  })

  it('turns the schedule off', async () => {
    get.mockResolvedValue(settings() as never)
    patch.mockResolvedValue(settings({ rescan_schedule_enabled: false }) as never)
    render(<ScheduledRescanSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'maintenance.scheduledRescan.off' }))
    fireEvent.click(screen.getByRole('button', { name: /saveSchedule/ }))
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        expect.objectContaining({
          rescan_schedule_enabled: false,
          rescan_schedule_interval: 'daily',
        })
      )
    )
    expect(await screen.findByRole('status')).toHaveTextContent('maintenance.scheduledRescan.saved')
  })

  it('reports unsaved edits until they are saved', async () => {
    get.mockResolvedValue(settings() as never)
    patch.mockResolvedValue(settings({ rescan_schedule_interval: 'hourly' }) as never)
    const { dirty, set, unmount } = renderWithDirty()

    const hourly = await screen.findByRole('button', {
      name: 'maintenance.scheduledRescan.hourly',
    })
    expect(dirty()).toBe(false)
    fireEvent.click(hourly)
    expect(dirty()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'maintenance.scheduledRescan.daily' }))
    expect(dirty()).toBe(false)
    fireEvent.click(screen.getByLabelText('maintenance.scheduledRescan.alsoRunCleanup'))
    expect(dirty()).toBe(true)
    fireEvent.click(screen.getByLabelText('maintenance.scheduledRescan.alsoRunCleanup'))
    fireEvent.change(screen.getByLabelText('maintenance.scheduledRescan.at'), {
      target: { value: '23:15' },
    })
    expect(dirty()).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /saveSchedule/ }))
    await screen.findByText('maintenance.scheduledRescan.saved')
    // The flag reaches the context from an effect, a render after the message.
    await waitFor(() => expect(dirty()).toBe(false))

    unmount()
    expect(set).toHaveBeenLastCalledWith('scheduled-rescan', false)
  })
})
