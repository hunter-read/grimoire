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

describe('VariantPicker', () => {
  it('renders nothing when there are no other versions', () => {
    const { container } = renderPicker({ id: 'a', variants: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the main entry plus every variant', () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    expect(screen.getByRole('option', { name: 'Main version' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'gridless' })).toBeInTheDocument()
    expect(screen.getByText('2 versions')).toBeInTheDocument()
  })

  it('prefers a free-text label over the kind', () => {
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'version', label: 'v1.0.1' }],
    })
    expect(screen.getByRole('option', { name: 'v1.0.1' })).toBeInTheDocument()
  })

  it('navigates when a different version is picked', async () => {
    mockNavigate.mockClear()
    renderPicker({
      id: 'a',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'b')
    expect(mockNavigate).toHaveBeenCalledWith('/maps/b')
  })

  it('shows the family when viewing a variant, not just the main entry', () => {
    // Opened on the variant: the picker still lists both, with this one selected.
    renderPicker({
      id: 'b',
      variant_main_id: 'a',
      variants: [{ id: 'b', kind: 'gridless', label: '' }],
    })
    expect(screen.getByRole('combobox')).toHaveValue('b')
    expect(screen.getByRole('option', { name: 'Main version' })).toBeInTheDocument()
  })
})
