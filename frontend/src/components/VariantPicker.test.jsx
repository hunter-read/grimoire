import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import VariantPicker from './VariantPicker'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k === 'variants.badge') return `${o.count} versions`
      if (k === 'variants.mainVersion') return 'Main version'
      if (k === 'variants.switchLabel') return 'Switch version'
      if (k.startsWith('variants.kind.')) return k.replace('variants.kind.', '')
      return k
    },
  }),
}))

const renderPicker = (item) =>
  render(
    <MemoryRouter>
      <VariantPicker item={item} detailPath={(id) => `/maps/${id}`} />
    </MemoryRouter>
  )

const openMenu = () => userEvent.click(screen.getByRole('button', { name: 'Switch version' }))

describe('VariantPicker', () => {
  it('renders nothing when there are no other versions', () => {
    const { container } = renderPicker({ id: 'a', variants: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the main entry plus every variant once opened', async () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    expect(screen.getByText('2 versions')).toBeInTheDocument()
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /Main version/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /gridless/ })).toBeInTheDocument()
  })

  it('keeps the menu closed until the trigger is clicked', () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('names the current version on the trigger, without its filename', async () => {
    // The trigger sits inline beside the title, so a long filename there is what
    // pushed the rest of the header off screen.
    renderPicker({
      id: 'b',
      variant_main_id: 'a',
      filename: 'main.webp',
      variants: [{ id: 'b', kind: 'universal-vtt', label: '', filename: 'a-very-long-name.uvtt' }],
    })
    const trigger = screen.getByRole('button', { name: 'Switch version' })
    expect(trigger).toHaveTextContent('universal-vtt')
    expect(trigger).not.toHaveTextContent('a-very-long-name.uvtt')
  })

  it('shows the filename under the name, once', async () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      filename: 'main.webp',
      variants: [{ id: 'b', kind: 'universal-vtt', label: '', filename: 'export.uvtt' }],
    })
    await openMenu()
    const row = screen.getByRole('menuitem', { name: /universal-vtt/ })
    expect(row).toHaveTextContent('export.uvtt')
    // Once, not twice: the label repeating the filename is the bug this guards.
    expect(row.textContent.match(/export\.uvtt/g)).toHaveLength(1)
  })

  it('does not repeat the filename when the label is the filename', async () => {
    // The indexer fills the label with the filename for an auto-detected pair.
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      filename: 'main.webp',
      variants: [{ id: 'b', kind: 'universal-vtt', label: 'export.uvtt', filename: 'export.uvtt' }],
    })
    await openMenu()
    const row = screen.getByRole('menuitem', { name: /universal-vtt/ })
    expect(row.textContent.match(/export\.uvtt/g)).toHaveLength(1)
  })

  it('prefers a free-text label over a generic kind', async () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'version', label: 'v1.0.1' }],
    })
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /v1\.0\.1/ })).toBeInTheDocument()
  })

  it('navigates when a different version is picked', async () => {
    mockNavigate.mockClear()
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /gridless/ }))
    expect(mockNavigate).toHaveBeenCalledWith('/maps/b')
  })

  it('closes without navigating when the current version is picked', async () => {
    mockNavigate.mockClear()
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /Main version/ }))
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('marks the version currently being viewed', async () => {
    renderPicker({
      id: 'b',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /gridless/ })).toHaveAttribute(
      'aria-current',
      'true'
    )
    expect(screen.getByRole('menuitem', { name: /Main version/ })).not.toHaveAttribute(
      'aria-current'
    )
  })

  it('shows the family when viewing a variant, not just the main entry', async () => {
    renderPicker({
      id: 'b',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /Main version/ })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on a click outside', async () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await openMenu()
    await userEvent.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
