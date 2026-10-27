import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MapGridEditor from './MapGridEditor'
import api from '../../api'

vi.mock('../../api', () => ({ default: { patch: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k),
  }),
}))

const baseMap = {
  id: 'm1',
  grid: { width: 10, height: 14, cell_px: 140, source: 'computed' },
  grid_width: null,
  grid_height: null,
  grid_px: null,
}

describe('MapGridEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.patch.mockResolvedValue({ status: 'ok', grid_warning: null })
  })

  it('seeds the fields from the detected grid', () => {
    render(<MapGridEditor map={baseMap} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('maps.detail.gridWidth')).toHaveValue(10)
    expect(screen.getByLabelText('maps.detail.gridCellSize')).toHaveValue(140)
  })

  it('prefers a stored override over the detected grid', () => {
    render(
      <MapGridEditor
        map={{ ...baseMap, grid_width: 10.5, grid_height: 14.5 }}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByLabelText('maps.detail.gridWidth')).toHaveValue(10.5)
  })

  it('saves the entered grid and closes', async () => {
    const onSaved = vi.fn()
    render(<MapGridEditor map={baseMap} onSaved={onSaved} onCancel={vi.fn()} />)
    const width = screen.getByLabelText('maps.detail.gridWidth')
    await userEvent.clear(width)
    await userEvent.type(width, '12')
    await userEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(api.patch).toHaveBeenCalledWith('/maps/m1', {
      grid_width: 12,
      grid_height: 14,
      grid_px: 140,
    })
  })

  it('shows the warning without closing, then saves anyway on confirm', async () => {
    api.patch.mockResolvedValueOnce({
      status: 'ok',
      grid_warning: { code: 'aspect_mismatch', cell_x: 200.87, cell_y: 140, suggested_width: 33 },
    })
    const onSaved = vi.fn()
    render(<MapGridEditor map={baseMap} onSaved={onSaved} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByText('common.save'))

    // The value is already stored — this is advisory, so the editor stays open
    // to show what the entered grid implies rather than reverting anything.
    await screen.findByRole('alert')
    expect(onSaved).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('maps.detail.gridSaveAnyway'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('sends zeroes to clear an existing override', async () => {
    const onSaved = vi.fn()
    render(
      <MapGridEditor
        map={{ ...baseMap, grid_width: 10.5, grid_height: 14.5 }}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />
    )
    await userEvent.click(screen.getByText('maps.detail.gridReset'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(api.patch).toHaveBeenCalledWith('/maps/m1', {
      grid_width: 0,
      grid_height: 0,
      grid_px: 0,
    })
  })

  it('offers no reset when there is no override to clear', () => {
    render(<MapGridEditor map={baseMap} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText('maps.detail.gridReset')).toBeNull()
  })

  it('treats a blank field as a cleared value', async () => {
    render(<MapGridEditor map={baseMap} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.clear(screen.getByLabelText('maps.detail.gridCellSize'))
    await userEvent.click(screen.getByText('common.save'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/maps/m1', {
        grid_width: 10,
        grid_height: 14,
        grid_px: 0,
      })
    )
  })

  it('stays open when the save fails', async () => {
    api.patch.mockRejectedValue(new Error('nope'))
    const onSaved = vi.fn()
    render(<MapGridEditor map={baseMap} onSaved={onSaved} onCancel={vi.fn()} />)
    await userEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(screen.getByText('common.save')).toBeEnabled())
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('cancels without saving', async () => {
    const onCancel = vi.fn()
    render(<MapGridEditor map={baseMap} onSaved={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByText('common.cancel'))
    expect(onCancel).toHaveBeenCalled()
    expect(api.patch).not.toHaveBeenCalled()
  })
})
