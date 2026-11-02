import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RescanSection from './RescanSection'
import useScanStatus from '../../hooks/useScanStatus'

vi.mock('../../hooks/useScanStatus', () => ({ default: vi.fn() }))
vi.mock('../RescanModal', () => ({
  default: ({ onConfirm }: { onConfirm: (mode: string) => void }) => (
    <button onClick={() => onConfirm('fill')}>confirm-rescan</button>
  ),
}))

const IDLE = {
  running: false,
  phase: null as string | null,
  indexed: 0,
  to_index: 0,
  total_books: 0,
  scanned_books: 0,
  total_maps: 0,
  scanned_maps: 0,
  total_tokens: 0,
  scanned_tokens: 0,
  total_audio: 0,
  scanned_audio: 0,
  total_models: 0,
  scanned_models: 0,
  total_ocr: 0,
  ocr_done: 0,
  ocr_current: '',
  total_thumbs: 0,
  thumbs_done: 0,
  thumbs_current: '',
  step_done: 0,
  step_total: 0,
}

const startRescan = vi.fn(() => Promise.resolve())
const stopScan = vi.fn(() => Promise.resolve())

function mockStatus(
  status: Partial<typeof IDLE>,
  lastResult: Record<string, unknown> | null = null
) {
  vi.mocked(useScanStatus).mockReturnValue({
    status: { ...IDLE, ...status },
    lastResult: lastResult ? { ...IDLE, ...lastResult } : null,
    stopping: false,
    startRescan,
    stopScan,
  } as unknown as ReturnType<typeof useScanStatus>)
}

const phaseStatus = () =>
  screen.getAllByRole('status').find((el) => el.className === 'sr-only') as HTMLElement

describe('RescanSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts a rescan from the confirmation', () => {
    mockStatus({})
    render(<RescanSection />)
    fireEvent.click(screen.getByRole('button', { name: /rescan/i }))
    fireEvent.click(screen.getByText('confirm-rescan'))
    expect(startRescan).toHaveBeenCalledWith({ scope: null, metadata_mode: 'fill' })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('exposes the walk as a progressbar with its percentage', () => {
    mockStatus({ running: true, phase: 'scanning', total_books: 10, scanned_books: 4 })
    render(<RescanSection />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAccessibleName()
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(stopScan).toHaveBeenCalled()
  })

  it('leaves the value out while the walk has nothing counted yet', () => {
    mockStatus({ running: true, phase: 'scanning' })
    render(<RescanSection />)
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  })

  it.each([
    ['pruning', { step_total: 4, step_done: 1 }, '25'],
    ['indexing', { to_index: 8, indexed: 2 }, '25'],
    ['ocr', { total_ocr: 4, ocr_done: 3, ocr_current: 'scan.pdf' }, '75'],
    ['thumbnails', { total_thumbs: 2, thumbs_done: 1, thumbs_current: 'map.png' }, '50'],
  ])('shows the %s phase as a progressbar', (phase, counts, pct) => {
    mockStatus({ running: true, phase, ...counts })
    render(<RescanSection />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', pct)
  })

  it('says the phase once as it starts, not on every count', () => {
    mockStatus({ running: true, phase: 'indexing', to_index: 8, indexed: 2 })
    const { rerender } = render(<RescanSection />)
    const first = phaseStatus().textContent
    expect(first).toBeTruthy()
    // The count moves on; the announcement stays as it was.
    mockStatus({ running: true, phase: 'indexing', to_index: 8, indexed: 6 })
    rerender(<RescanSection />)
    expect(phaseStatus().textContent).toBe(first)
    // A new phase is said.
    mockStatus({ running: true, phase: 'ocr', total_ocr: 4, ocr_done: 0 })
    rerender(<RescanSection />)
    expect(phaseStatus().textContent).not.toBe(first)
  })

  it('announces the summary when the scan has finished', () => {
    mockStatus({}, { new_books: 2, new_maps: 1, new_tokens: 1, new_audio: 1, new_models: 1 })
    render(<RescanSection />)
    const summary = screen
      .getAllByRole('status')
      .find((el) => el.className !== 'sr-only') as HTMLElement
    expect(summary).toBeInTheDocument()
    expect(phaseStatus()).toHaveTextContent('')
  })
})
