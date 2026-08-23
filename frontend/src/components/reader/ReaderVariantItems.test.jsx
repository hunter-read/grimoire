import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o?.defaultValue ? o.defaultValue : k) }),
}))

import ReaderVariantItems from './ReaderVariantItems'

// Mirrors ReaderMoreMenu's own helper: stop propagation, close, then act.
const run = (fn) => (e) => {
  e?.stopPropagation?.()
  fn()
}

const book = {
  id: 'b1',
  variant_main_id: 'b1',
  variants: [
    { id: 'b2', kind: 'spreads', label: '' },
    { id: 'b3', kind: 'version', label: 'v1.0.1' },
  ],
}

const renderItems = (props = {}, initialEntries = ['/library/book/b1']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <ReaderVariantItems
        book={book}
        bookId="b1"
        itemStyle={{}}
        dividerStyle={{}}
        run={run}
        {...props}
      />
    </MemoryRouter>
  )

describe('ReaderVariantItems', () => {
  it('renders nothing when the book stands alone', () => {
    const { container } = renderItems({ book: { id: 'b1', variants: [] } })
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the main entry and every variant', () => {
    renderItems()
    expect(screen.getByRole('menuitemradio', { name: /mainVersion/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /spreads/ })).toBeInTheDocument()
    // A free-text label wins over the kind.
    expect(screen.getByRole('menuitemradio', { name: /v1\.0\.1/ })).toBeInTheDocument()
  })

  it('checks the version currently open', () => {
    renderItems()
    expect(screen.getByRole('menuitemradio', { name: /mainVersion/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('menuitemradio', { name: /spreads/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('keeps the current page when switching', async () => {
    mockNavigate.mockClear()
    renderItems({}, ['/library/book/b1?page=42'])
    await userEvent.click(screen.getByRole('menuitemradio', { name: /spreads/ }))
    expect(mockNavigate).toHaveBeenCalledWith('/library/book/b2?page=42')
  })

  it('omits the page param when there is none', async () => {
    mockNavigate.mockClear()
    renderItems()
    await userEvent.click(screen.getByRole('menuitemradio', { name: /spreads/ }))
    expect(mockNavigate).toHaveBeenCalledWith('/library/book/b2')
  })

  it('does nothing when the open version is re-picked', async () => {
    mockNavigate.mockClear()
    renderItems()
    await userEvent.click(screen.getByRole('menuitemradio', { name: /mainVersion/ }))
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
