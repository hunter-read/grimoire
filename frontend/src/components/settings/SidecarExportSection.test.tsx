import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import SidecarExportSection from './SidecarExportSection'
import { sidecars } from '../../api'
import { SettingsDirtyContext } from './settingsDirty'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))
vi.mock('../../api', () => ({
  sidecars: { get: vi.fn(), save: vi.fn(), export: vi.fn() },
}))

const DISABLED = { formats: [], covers: false, overwrite_foreign: false }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sidecars.get).mockResolvedValue(DISABLED)
})

// Queried live rather than captured: each visible label concatenates its label
// and hint text, so a text matcher for one checkbox also matches its
// neighbours — the id is the only unambiguous handle.
const box = (id: string) =>
  screen.getByRole('checkbox', { name: (_: string, el: Element) => el.id === id })
const formatBox = (fmt: string) => box(`sidecar-format-${fmt}`)
const saveButton = () => screen.getByRole('button', { name: /sidecars\.save$/ })
const exportButton = () => screen.getByRole('button', { name: /sidecars\.export$/ })

describe('SidecarExportSection', () => {
  it('reports unsaved edits until they are saved, and announces the save', async () => {
    vi.mocked(sidecars.save).mockImplementation((body) => Promise.resolve(body))
    const set = vi.fn()
    const dirty = () => set.mock.calls.filter(([id]) => id === 'sidecars').at(-1)?.[1]
    const { unmount } = render(
      <SettingsDirtyContext.Provider value={{ set }}>
        <SidecarExportSection />
      </SettingsDirtyContext.Provider>
    )
    await waitFor(() => expect(formatBox('opf')).toBeInTheDocument())
    expect(dirty()).toBe(false)

    fireEvent.click(formatBox('opf'))
    expect(dirty()).toBe(true)
    fireEvent.click(formatBox('opf'))
    expect(dirty()).toBe(false)
    fireEvent.click(box('sidecar-covers'))
    expect(dirty()).toBe(true)
    fireEvent.click(box('sidecar-covers'))
    fireEvent.click(box('sidecar-overwrite'))
    expect(dirty()).toBe(true)
    fireEvent.click(formatBox('nfo'))

    fireEvent.click(saveButton())
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('maintenance.sidecars.saved')
    )
    // The dirty flag is reported from an effect, which can run after the
    // status paints.
    await waitFor(() => expect(dirty()).toBe(false))

    unmount()
    expect(set).toHaveBeenLastCalledWith('sidecars', false)
  })

  it('loads the current settings on mount', async () => {
    vi.mocked(sidecars.get).mockResolvedValue({
      formats: ['opf', 'json'],
      covers: true,
      overwrite_foreign: false,
    })
    render(<SidecarExportSection />)

    await waitFor(() => expect(sidecars.get).toHaveBeenCalled())
    expect(await screen.findByText('maintenance.sidecars.title')).toBeInTheDocument()
    expect(formatBox('opf')).toBeChecked()
    expect(formatBox('json')).toBeChecked()
    expect(formatBox('nfo')).not.toBeChecked()
  })

  it('offers every format Grimoire can write', async () => {
    render(<SidecarExportSection />)

    await waitFor(() => expect(sidecars.get).toHaveBeenCalled())
    for (const fmt of ['opf', 'nfo', 'json', 'yaml']) {
      expect(formatBox(fmt)).toBeInTheDocument()
    }
  })

  it('starts with nothing enabled, so export writes nothing until asked', async () => {
    render(<SidecarExportSection />)

    await waitFor(() => expect(sidecars.get).toHaveBeenCalled())
    for (const fmt of ['opf', 'nfo', 'json', 'yaml']) {
      expect(formatBox(fmt)).not.toBeChecked()
    }
    expect(exportButton()).toBeDisabled()
  })

  it('saves the chosen formats and toggles', async () => {
    vi.mocked(sidecars.save).mockResolvedValue({
      formats: ['nfo'],
      covers: true,
      overwrite_foreign: false,
    })
    render(<SidecarExportSection />)
    await waitFor(() => expect(sidecars.get).toHaveBeenCalled())

    fireEvent.click(formatBox('nfo'))
    fireEvent.click(box('sidecar-covers'))
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(sidecars.save).toHaveBeenCalledWith({
        formats: ['nfo'],
        covers: true,
        overwrite_foreign: false,
      })
    )
    expect(await screen.findByText('maintenance.sidecars.saved')).toBeInTheDocument()
  })

  it('unchecking a format removes it from the saved set', async () => {
    vi.mocked(sidecars.get).mockResolvedValue({
      formats: ['opf', 'nfo'],
      covers: false,
      overwrite_foreign: false,
    })
    vi.mocked(sidecars.save).mockResolvedValue({
      formats: ['opf'],
      covers: false,
      overwrite_foreign: false,
    })
    render(<SidecarExportSection />)
    await waitFor(() => expect(sidecars.get).toHaveBeenCalled())

    fireEvent.click(formatBox('nfo'))
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(sidecars.save).toHaveBeenCalledWith({
        formats: ['opf'],
        covers: false,
        overwrite_foreign: false,
      })
    )
  })

  it('can enable YAML, the hand-editable lossless format', async () => {
    vi.mocked(sidecars.get).mockResolvedValue(DISABLED)
    vi.mocked(sidecars.save).mockResolvedValue({
      formats: ['yaml'],
      covers: false,
      overwrite_foreign: false,
    })
    render(<SidecarExportSection />)

    await waitFor(() => expect(sidecars.get).toHaveBeenCalled())
    fireEvent.click(formatBox('yaml'))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() =>
      expect(sidecars.save).toHaveBeenCalledWith({
        formats: ['yaml'],
        covers: false,
        overwrite_foreign: false,
      })
    )
  })

  it('runs the backfill once a format is enabled', async () => {
    vi.mocked(sidecars.get).mockResolvedValue({
      formats: ['opf'],
      covers: false,
      overwrite_foreign: false,
    })
    vi.mocked(sidecars.export).mockResolvedValue({
      written: 12,
      skipped_foreign: 0,
      skipped_missing: 0,
      failed: 0,
      covers: 0,
      read_only: false,
      errors: [],
    })
    render(<SidecarExportSection />)
    await waitFor(() => expect(sidecars.get).toHaveBeenCalled())

    fireEvent.click(exportButton())

    await waitFor(() => expect(sidecars.export).toHaveBeenCalled())
    expect(await screen.findByText('maintenance.sidecars.written')).toBeInTheDocument()
  })

  it('reports files it refused to overwrite', async () => {
    vi.mocked(sidecars.get).mockResolvedValue({
      formats: ['opf'],
      covers: false,
      overwrite_foreign: false,
    })
    vi.mocked(sidecars.export).mockResolvedValue({
      written: 3,
      skipped_foreign: 2,
      skipped_missing: 0,
      failed: 0,
      covers: 0,
      read_only: false,
      errors: ['handbook.opf: exists and was not written by Grimoire'],
    })
    render(<SidecarExportSection />)
    await waitFor(() => expect(sidecars.get).toHaveBeenCalled())

    fireEvent.click(exportButton())

    expect(await screen.findByText('maintenance.sidecars.skippedForeign')).toBeInTheDocument()
    expect(
      screen.getByText('handbook.opf: exists and was not written by Grimoire')
    ).toBeInTheDocument()
  })

  it('surfaces a read-only library rather than looking successful', async () => {
    vi.mocked(sidecars.get).mockResolvedValue({
      formats: ['opf'],
      covers: false,
      overwrite_foreign: false,
    })
    vi.mocked(sidecars.export).mockResolvedValue({
      written: 0,
      skipped_foreign: 0,
      skipped_missing: 0,
      failed: 1,
      covers: 0,
      read_only: true,
      errors: ['The library is mounted read-only, so metadata sidecars cannot be written.'],
    })
    render(<SidecarExportSection />)
    await waitFor(() => expect(sidecars.get).toHaveBeenCalled())

    fireEvent.click(exportButton())

    expect(await screen.findByText('maintenance.sidecars.failed')).toBeInTheDocument()
    expect(screen.getByText(/The library is mounted read-only/)).toBeInTheDocument()
  })

  it('reports a failed save', async () => {
    vi.mocked(sidecars.save).mockRejectedValue(new Error('nope'))
    render(<SidecarExportSection />)
    await waitFor(() => expect(sidecars.get).toHaveBeenCalled())

    fireEvent.click(saveButton())

    expect(await screen.findByText('maintenance.sidecars.saveFailed')).toBeInTheDocument()
  })

  it('reports a failed export', async () => {
    vi.mocked(sidecars.get).mockResolvedValue({
      formats: ['opf'],
      covers: false,
      overwrite_foreign: false,
    })
    vi.mocked(sidecars.export).mockRejectedValue(new Error('nope'))
    render(<SidecarExportSection />)
    await waitFor(() => expect(sidecars.get).toHaveBeenCalled())

    fireEvent.click(exportButton())

    expect(await screen.findByText('maintenance.sidecars.exportFailed')).toBeInTheDocument()
  })

  it('reports when the settings cannot be loaded', async () => {
    vi.mocked(sidecars.get).mockRejectedValue(new Error('nope'))
    render(<SidecarExportSection />)

    expect(await screen.findByText('maintenance.sidecars.loadFailed')).toBeInTheDocument()
  })
})
