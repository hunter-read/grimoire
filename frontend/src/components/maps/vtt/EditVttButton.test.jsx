import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import EditVttButton from './EditVttButton'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

const renderButton = (map, props = {}) =>
  render(
    <MemoryRouter>
      <EditVttButton map={map} {...props} />
    </MemoryRouter>
  )

const raster = (over = {}) => ({ id: 'm1', filename: 'keep.png', variants: [], ...over })

beforeEach(() => vi.clearAllMocks())

describe('EditVttButton', () => {
  it('goes straight to the editor for a plain raster map', async () => {
    renderButton(raster())
    // One target should not cost a menu — it is the common case.
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(screen.getByRole('button'))
    expect(navigate).toHaveBeenCalledWith('/maps/m1/vtt-editor')
  })

  it('goes straight to the editor for a standalone .uvtt', async () => {
    renderButton({ id: 'v1', filename: 'tavern.uvtt', media_kind: 'vtt', variants: [] })
    await userEvent.click(screen.getByRole('button'))
    expect(navigate).toHaveBeenCalledWith('/maps/v1/vtt-editor')
  })

  it('offers both halves of a linked pair', async () => {
    renderButton(raster({ variants: [{ id: 'v1', kind: 'universal-vtt', filename: 'keep.uvtt' }] }))
    await userEvent.click(screen.getByRole('button', { name: /maps.vtt.edit/ }))
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('maps.vtt.target.image')
    expect(items[1]).toHaveTextContent('maps.vtt.target.vtt')
  })

  it('navigates to the chosen half of a pair', async () => {
    renderButton(raster({ variants: [{ id: 'v1', kind: 'universal-vtt', filename: 'keep.uvtt' }] }))
    await userEvent.click(screen.getByRole('button', { name: /maps.vtt.edit/ }))
    await userEvent.click(screen.getByText('maps.vtt.target.vtt'))
    // Choosing the linked file must open *that* map, not the raster it hangs off.
    expect(navigate).toHaveBeenCalledWith('/maps/v1/vtt-editor')
  })

  it('closes the menu on Escape', async () => {
    renderButton(raster({ variants: [{ id: 'v1', kind: 'universal-vtt', filename: 'keep.uvtt' }] }))
    await userEvent.click(screen.getByRole('button', { name: /maps.vtt.edit/ }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    ['a PDF', { is_pdf: true }],
    ['a video', { media_kind: 'video' }],
    ['an archive', { media_kind: 'archive' }],
  ])('renders nothing for %s', (_label, over) => {
    const { container } = renderButton(raster(over))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without a map', () => {
    const { container } = renderButton(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides its label when compact', () => {
    renderButton(raster(), { compact: true })
    // The icon still identifies it; only the text is dropped on a phone.
    expect(screen.getByRole('button')).not.toHaveTextContent('maps.vtt.edit')
  })
})
