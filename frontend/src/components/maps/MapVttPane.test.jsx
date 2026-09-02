import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MapVttPane from './MapVttPane'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn() },
  mediaUrl: (p) => `http://localhost${p}`,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const DATA = { grid_width: 20, grid_height: 16, pixels_per_grid: 100, wall_count: 12 }

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue(DATA)
})

describe('MapVttPane', () => {
  it('renders the server-decoded image rather than the base64 envelope', () => {
    render(<MapVttPane mapId="m1" filename="tavern.uvtt" />)
    const img = screen.getByAltText('tavern.uvtt')
    expect(img.getAttribute('src')).toContain('/maps/m1/vtt/image')
    // The raw .uvtt JSON must never be what the <img> points at.
    expect(img.getAttribute('src')).not.toContain('/file')
  })

  it('passes parsed grid and feature data up to the parent', async () => {
    const onData = vi.fn()
    render(<MapVttPane mapId="m1" filename="tavern.uvtt" onData={onData} />)
    await waitFor(() => expect(onData).toHaveBeenCalledWith(DATA))
    expect(api.get).toHaveBeenCalledWith('/maps/m1/vtt/data')
  })

  it('reports null upward when the file cannot be parsed', async () => {
    api.get.mockRejectedValue(new Error('bad json'))
    const onData = vi.fn()
    render(<MapVttPane mapId="m1" filename="broken.uvtt" onData={onData} />)
    await waitFor(() => expect(onData).toHaveBeenCalledWith(null))
  })

  it('spins until the image loads and surfaces image failures', () => {
    render(<MapVttPane mapId="m1" filename="tavern.uvtt" />)
    expect(screen.getByRole('status')).toBeTruthy()

    fireEvent.error(screen.getByAltText('tavern.uvtt'))

    expect(screen.getByText('maps.detail.vttFailed')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
