import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import BackupScheduleSection from './BackupScheduleSection'
import { backups } from '../../api'
import type { Schema } from '../../api'
import { SettingsDirtyContext } from './settingsDirty'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))
vi.mock('../../api', () => ({
  backups: { getSettings: vi.fn(), saveSettings: vi.fn() },
}))

const SETTINGS = {
  backup_schedule: 'off',
  backup_schedule_hour: 3,
  backup_schedule_minute: 0,
  backup_schedule_weekday: 0,
  backup_retention_count: 0,
  backup_retention_gb: 0,
  backup_dir: '/data/backups',
  schedule_env_locked: false,
  retention_count_env_locked: false,
  retention_gb_env_locked: false,
  dir_env_locked: false,
}

const saveButton = () => screen.getByRole('button', { name: /schedule\.save$/ })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(backups.getSettings).mockResolvedValue(SETTINGS)
  vi.mocked(backups.saveSettings).mockImplementation((patch) =>
    Promise.resolve({
      ...SETTINGS,
      ...patch,
      backup_dir: patch.backup_dir || SETTINGS.backup_dir,
    } as Schema<'BackupSettingsResponse'>)
  )
})

describe('BackupScheduleSection', () => {
  it('loads current settings on mount', async () => {
    render(<BackupScheduleSection />)

    await waitFor(() => expect(backups.getSettings).toHaveBeenCalled())
    expect(await screen.findByText('backups.schedule.title')).toBeInTheDocument()
  })

  it('saves the selected frequency and retention limits', async () => {
    render(<BackupScheduleSection />)
    await screen.findByText('backups.schedule.title')

    fireEvent.click(screen.getByRole('button', { name: 'backups.schedule.daily' }))
    fireEvent.change(screen.getByLabelText(/retention\.countLabel/), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText(/retention\.sizeLabel/), { target: { value: '10' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(backups.saveSettings).toHaveBeenCalled())
    const patch = vi.mocked(backups.saveSettings).mock.calls[0][0]
    expect(patch.backup_schedule).toBe('daily')
    expect(patch.backup_retention_count).toBe(5)
    expect(patch.backup_retention_gb).toBe(10)
  })

  it('shows a weekday picker only for a weekly schedule', async () => {
    render(<BackupScheduleSection />)
    await screen.findByText('backups.schedule.title')

    expect(screen.queryByRole('button', { name: /weekdays\.mon/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'backups.schedule.weekly' }))
    expect(screen.getByRole('button', { name: /weekdays\.mon/ })).toBeInTheDocument()
  })

  it('hides the time picker for an hourly schedule', async () => {
    render(<BackupScheduleSection />)
    await screen.findByText('backups.schedule.title')

    fireEvent.click(screen.getByRole('button', { name: 'backups.schedule.hourly' }))
    expect(screen.queryByLabelText(/scheduledRescan\.at/)).not.toBeInTheDocument()
  })

  it('notifies the parent after a successful save', async () => {
    const onSaved = vi.fn()
    render(<BackupScheduleSection onSaved={onSaved} />)
    await screen.findByText('backups.schedule.title')

    fireEvent.click(saveButton())
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('surfaces a rejected save', async () => {
    vi.mocked(backups.saveSettings).mockRejectedValue(
      new Error('Parent directory does not exist: /nope')
    )
    render(<BackupScheduleSection />)
    await screen.findByText('backups.schedule.title')

    fireEvent.click(saveButton())
    expect(await screen.findByText(/Parent directory does not exist/)).toBeInTheDocument()
  })

  it('says why it has nothing to show when the settings fail to load', async () => {
    vi.mocked(backups.getSettings).mockRejectedValue(new Error('down'))
    render(<BackupScheduleSection />)
    expect(await screen.findByText('backups.schedule.loadFailed')).toBeInTheDocument()
  })

  it('announces a save and falls back to a generic failure message', async () => {
    render(<BackupScheduleSection />)
    await screen.findByText('backups.schedule.title')
    fireEvent.click(saveButton())
    expect(await screen.findByRole('status')).toHaveTextContent('backups.schedule.saved')

    vi.mocked(backups.saveSettings).mockRejectedValue({})
    fireEvent.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('backups.schedule.saveFailed')
  })

  it('reports unsaved edits until they are saved', async () => {
    const set = vi.fn()
    const dirty = () => set.mock.calls.filter(([id]) => id === 'backup-schedule').at(-1)?.[1]
    const { unmount } = render(
      <SettingsDirtyContext.Provider value={{ set }}>
        <BackupScheduleSection />
      </SettingsDirtyContext.Provider>
    )
    await screen.findByText('backups.schedule.title')
    expect(dirty()).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'backups.schedule.weekly' }))
    expect(dirty()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'backups.schedule.off' }))
    expect(dirty()).toBe(false)

    fireEvent.change(screen.getByLabelText(/retention\.countLabel/), { target: { value: '5' } })
    expect(dirty()).toBe(true)
    fireEvent.change(screen.getByLabelText(/retention\.countLabel/), { target: { value: '0' } })
    expect(dirty()).toBe(false)

    fireEvent.change(screen.getByLabelText(/location\.title/), { target: { value: '/elsewhere' } })
    expect(dirty()).toBe(true)
    fireEvent.click(saveButton())
    await screen.findByText('backups.schedule.saved')
    expect(dirty()).toBe(false)

    unmount()
    expect(set).toHaveBeenLastCalledWith('backup-schedule', false)
  })

  describe('env-locked fields', () => {
    it('disables the controls an env var pins', async () => {
      vi.mocked(backups.getSettings).mockResolvedValue({
        ...SETTINGS,
        backup_schedule: 'daily',
        schedule_env_locked: true,
        retention_count_env_locked: true,
        dir_env_locked: true,
      })
      render(<BackupScheduleSection />)
      await screen.findByText('backups.schedule.title')

      expect(screen.getByRole('button', { name: 'backups.schedule.daily' })).toBeDisabled()
      expect(screen.getByLabelText(/retention\.countLabel/)).toBeDisabled()
      expect(screen.getByLabelText(/location\.title/)).toBeDisabled()
    })

    it('never sends a locked field, which the API would reject', async () => {
      vi.mocked(backups.getSettings).mockResolvedValue({
        ...SETTINGS,
        schedule_env_locked: true,
        retention_gb_env_locked: true,
      })
      render(<BackupScheduleSection />)
      await screen.findByText('backups.schedule.title')

      fireEvent.click(saveButton())

      await waitFor(() => expect(backups.saveSettings).toHaveBeenCalled())
      const patch = vi.mocked(backups.saveSettings).mock.calls[0][0]
      expect(patch).not.toHaveProperty('backup_schedule')
      expect(patch).not.toHaveProperty('backup_retention_gb')
      // Unlocked fields still go.
      expect(patch).toHaveProperty('backup_retention_count')
    })
  })
})
