import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OtfbmExportModal from './OtfbmExportModal'
import api, { shareLinks } from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn() },
  shareLinks: { list: vi.fn(), create: vi.fn() },
  mediaUrl: (p, params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return `/api${p}${qs ? `?${qs}` : ''}`
  },
}))

vi.mock('react-i18next', () => {
  const t = (k, opts) => (opts ? `${k} ${JSON.stringify(opts)}` : k)
  return { useTranslation: () => ({ t, i18n: { language: 'en-US' } }) }
})

const plan = (over = {}) => ({
  width: 10,
  height: 14,
  cell: 70,
  suggested_cell: 70,
  source_px: 140,
  grid_source: 'computed',
  image_width: 700,
  image_height: 980,
  truncated: false,
  min_cell: 20,
  max_cell: 100,
  ...over,
})

const otfbmLink = (over = {}) => ({
  id: 'l1',
  url: 'https://g.example/share/tok',
  file_url: 'https://g.example/api/share/tok/village-10x14c70.jpg',
  state: 'active',
  has_password: false,
  variant: 'otfbm',
  variant_options: { cell: 70 },
  expires_at: null,
  ...over,
})

const renderModal = (props = {}) =>
  render(<OtfbmExportModal mapId="m1" filename="village.png" onClose={vi.fn()} {...props} />)

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((url) => {
    const match = /cell=(\d+)/.exec(url)
    if (!match) return Promise.resolve(plan())
    const cell = Number(match[1])
    return Promise.resolve(plan({ cell, image_width: cell * 10, image_height: cell * 14 }))
  })
  shareLinks.list.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('OtfbmExportModal', () => {
  it('seeds the cell size from the server and looks for existing OTFBM links', async () => {
    renderModal()
    await waitFor(() => expect(screen.getByLabelText('maps.otfbm.cellSize')).toHaveValue(70))
    expect(api.get).toHaveBeenCalledWith('/maps/m1/otfbm')
    expect(shareLinks.list).toHaveBeenCalledWith({
      resource_type: 'map',
      resource_id: 'm1',
      variant: 'otfbm',
    })
    expect(screen.getByTestId('otfbm-summary')).toHaveTextContent('"imageWidth":700')
  })

  it('creates a share link and fills the command with it', async () => {
    shareLinks.create.mockResolvedValue(otfbmLink())
    renderModal()
    const create = await screen.findByText('maps.otfbm.createLink')
    expect(screen.queryByLabelText('maps.otfbm.command')).toBeNull()
    fireEvent.change(screen.getByLabelText('share.form.expiry'), { target: { value: '30' } })
    fireEvent.click(create)
    await waitFor(() =>
      expect(shareLinks.create).toHaveBeenCalledWith({
        resource_type: 'map',
        resource_id: 'm1',
        variant: 'otfbm',
        cell: 70,
        label: 'maps.otfbm.linkLabel {"cell":70}',
        expires_in_days: 30,
      })
    )
    expect(await screen.findByLabelText('maps.otfbm.command')).toHaveValue(
      '!map -mapsize 10x14 -options c70 -bg https://g.example/api/share/tok/village-10x14c70.jpg'
    )
    expect(screen.getByTestId('otfbm-link-status')).toHaveTextContent('maps.otfbm.linkForever')
  })

  it('reuses an existing link at the same cell size', async () => {
    shareLinks.list.mockResolvedValue([otfbmLink({ expires_at: '2026-11-01T00:00:00Z' })])
    renderModal()
    expect(await screen.findByLabelText('maps.otfbm.command')).toHaveValue(
      '!map -mapsize 10x14 -options c70 -bg https://g.example/api/share/tok/village-10x14c70.jpg'
    )
    expect(screen.queryByText('maps.otfbm.createLink')).toBeNull()
    expect(screen.getByTestId('otfbm-link-status')).toHaveTextContent('maps.otfbm.linkUntil')
  })

  it('ignores links that would not work for OTFBM', async () => {
    shareLinks.list.mockResolvedValue([
      otfbmLink({ id: 'a', state: 'revoked' }),
      otfbmLink({ id: 'b', has_password: true }),
      otfbmLink({ id: 'c', variant_options: { cell: 50 } }),
    ])
    renderModal()
    expect(await screen.findByText('maps.otfbm.createLink')).toBeInTheDocument()
  })

  it('switches to the matching link when the cell size changes', async () => {
    shareLinks.list.mockResolvedValue([
      otfbmLink({
        id: 'c50',
        file_url: 'https://g.example/api/share/t50/v.jpg',
        variant_options: { cell: 50 },
      }),
    ])
    renderModal()
    const field = screen.getByLabelText('maps.otfbm.cellSize')
    await waitFor(() => expect(field).toHaveValue(70))
    expect(await screen.findByText('maps.otfbm.createLink')).toBeInTheDocument()
    fireEvent.change(field, { target: { value: '50' } })
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/maps/m1/otfbm?cell=50'))
    expect(await screen.findByLabelText('maps.otfbm.command')).toHaveValue(
      '!map -mapsize 10x14 -options c50 -bg https://g.example/api/share/t50/v.jpg'
    )
  })

  it('reports a failed link creation', async () => {
    shareLinks.create.mockRejectedValue(new Error('not allowed'))
    renderModal()
    fireEvent.click(await screen.findByText('maps.otfbm.createLink'))
    expect(await screen.findByText('not allowed')).toBeInTheDocument()
  })

  it('still offers the image to host elsewhere', async () => {
    renderModal()
    const link = await screen.findByRole('link', { name: /maps.otfbm.download/ })
    expect(link).toHaveAttribute('href', '/api/maps/m1/otfbm/image?cell=70')
  })

  it('debounces typing so intermediate values are not planned', async () => {
    renderModal()
    const field = screen.getByLabelText('maps.otfbm.cellSize')
    await waitFor(() => expect(field).toHaveValue(70))
    vi.useFakeTimers()
    fireEvent.change(field, { target: { value: '4' } })
    fireEvent.change(field, { target: { value: '45' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(api.get).toHaveBeenCalledWith('/maps/m1/otfbm?cell=45')
    expect(api.get).not.toHaveBeenCalledWith('/maps/m1/otfbm?cell=4')
  })

  it('rejects an out-of-range cell size and offers nothing to act on', async () => {
    renderModal()
    const field = screen.getByLabelText('maps.otfbm.cellSize')
    await screen.findByText('maps.otfbm.createLink')
    fireEvent.change(field, { target: { value: '150' } })
    expect(screen.getByText(/maps.otfbm.cellInvalid/)).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('maps.otfbm.createLink')).toBeNull()
    expect(screen.queryByRole('link', { name: /maps.otfbm.download/ })).toBeNull()
  })

  it('warns when the grid is only the default guess', async () => {
    api.get.mockResolvedValue(plan({ grid_source: 'default' }))
    renderModal()
    expect(await screen.findByText('maps.otfbm.defaultGrid')).toBeInTheDocument()
  })

  it('warns when the map is larger than OTFBM can show', async () => {
    api.get.mockResolvedValue(plan({ truncated: true, width: 99 }))
    renderModal()
    expect(await screen.findByText('maps.otfbm.truncated')).toBeInTheDocument()
  })

  it('copies the command to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    shareLinks.list.mockResolvedValue([otfbmLink()])
    renderModal()
    await screen.findByLabelText('maps.otfbm.command')
    await userEvent.click(screen.getByRole('button', { name: /maps.otfbm.copy/ }))
    expect(writeText).toHaveBeenCalledWith(
      '!map -mapsize 10x14 -options c70 -bg https://g.example/api/share/tok/village-10x14c70.jpg'
    )
    expect(await screen.findByText('maps.otfbm.copied')).toBeInTheDocument()
  })

  it('survives a clipboard that refuses', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    shareLinks.list.mockResolvedValue([otfbmLink()])
    renderModal()
    await screen.findByLabelText('maps.otfbm.command')
    await userEvent.click(screen.getByRole('button', { name: /maps.otfbm.copy/ }))
    expect(screen.queryByText('maps.otfbm.copied')).toBeNull()
  })

  it('treats a failed link listing as no links', async () => {
    shareLinks.list.mockRejectedValue(new Error('down'))
    renderModal()
    expect(await screen.findByText('maps.otfbm.createLink')).toBeInTheDocument()
  })

  it('shows an error when the plan cannot be loaded', async () => {
    api.get.mockRejectedValue(new Error('403'))
    renderModal()
    expect(await screen.findByRole('alert')).toHaveTextContent('maps.otfbm.loadFailed')
  })

  it('closes on Escape, the close button, and a backdrop click', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'common.close' }))
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
