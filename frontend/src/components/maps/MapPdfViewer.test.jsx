import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MapPdfViewer from './MapPdfViewer'

vi.mock('../../api', () => ({
  mediaUrl: (p, params) => {
    const qs = params ? new URLSearchParams(params).toString() : ''
    return `/api${p}${qs ? `?${qs}` : ''}`
  },
}))

vi.mock('../../hooks/useReaderGestures', () => ({
  default: () => ({
    handleTouchStart: vi.fn(),
    handleTouchMove: vi.fn(),
    handleTouchEnd: vi.fn(),
  }),
}))

vi.mock('../../hooks/useUserPrefs', () => ({
  getUserPrefs: () => ({}),
}))

vi.mock('../../hooks/useBookPrefs', () => ({
  getBookPrefs: () => ({}),
  saveBookPrefs: vi.fn(),
}))

// Render the page components as their requested URL so assertions can inspect it.
vi.mock('../reader/SinglePage', () => ({
  default: ({ currentPage, pageUrl }) => (
    <div data-testid="single-page">{pageUrl(currentPage, 1600)}</div>
  ),
}))
vi.mock('../reader/SpreadPage', () => ({
  default: ({ currentPage, rightPage, hasRight, pageUrl }) => (
    <div data-testid="spread-page">
      {pageUrl(currentPage, 1000)}
      {hasRight ? `|${pageUrl(rightPage, 1000)}` : ''}
    </div>
  ),
}))

beforeEach(() => vi.clearAllMocks())

const setup = (over = {}) =>
  render(
    <MapPdfViewer
      mapId="m1"
      filename="dungeon.pdf"
      totalPages={5}
      isMobilePhone={false}
      {...over}
    />
  )

describe('MapPdfViewer', () => {
  it('renders the single-page view by default, requesting page 1', () => {
    setup()
    expect(screen.getByTestId('single-page')).toHaveTextContent('/api/maps/m1/page/1?width=1600')
  })

  it('advances the page with the next control', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getByTestId('single-page')).toHaveTextContent('/maps/m1/page/2?width=1600')
  })

  it('disables the previous control on the first page', () => {
    setup()
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled()
  })

  it('switches to spread mode and pairs facing pages', async () => {
    setup()
    // Move to page 2 first, then switch to spread — page 2 pairs with page 3.
    await userEvent.click(screen.getByRole('button', { name: /next page/i }))
    await userEvent.click(screen.getByRole('button', { name: /spread/i }))
    const spread = screen.getByTestId('spread-page')
    expect(spread).toHaveTextContent('/api/maps/m1/page/2?width=1000')
    expect(spread).toHaveTextContent('/api/maps/m1/page/3?width=1000')
  })

  it('navigates pages with the arrow keys', async () => {
    setup()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByTestId('single-page')).toHaveTextContent('/maps/m1/page/2?width=1600')
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByTestId('single-page')).toHaveTextContent('/maps/m1/page/3?width=1600')
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByTestId('single-page')).toHaveTextContent('/maps/m1/page/2?width=1600')
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByTestId('single-page')).toHaveTextContent('/maps/m1/page/1?width=1600')
  })

  it('jumps to a typed page number', async () => {
    setup()
    const input = screen.getByRole('textbox', { name: /current page/i })
    await userEvent.clear(input)
    await userEvent.type(input, '4{Enter}')
    expect(screen.getByTestId('single-page')).toHaveTextContent('/maps/m1/page/4?width=1600')
  })

  it('toggles the spread cover offset in spread mode', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /spread/i }))
    // Offset toggle appears only in spread mode.
    const coverToggle = screen.getByRole('button', { name: /cover/i })
    await userEvent.click(coverToggle)
    // With offset 1, page 1 pairs with page 2 as a spread.
    const spread = screen.getByTestId('spread-page')
    expect(spread).toHaveTextContent('/api/maps/m1/page/1?width=1000')
    expect(spread).toHaveTextContent('/api/maps/m1/page/2?width=1000')
  })

  it('renders the raw PDF in an iframe in pdf mode', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^pdf$/i }))
    const frame = document.querySelector('iframe')
    expect(frame).toBeInTheDocument()
    expect(frame.getAttribute('src')).toBe('/api/maps/m1/file#page=1')
  })

  it('hides the mode toggle on mobile phones', () => {
    setup({ isMobilePhone: true })
    // Mode toggle container is display:none; the spread/pdf buttons should not be
    // reachable, but single-page content still renders.
    expect(screen.getByTestId('single-page')).toBeInTheDocument()
    const spreadBtn = screen.queryByRole('button', { name: /spread/i })
    // The button exists in the DOM but its container is hidden; assert single mode.
    if (spreadBtn) expect(spreadBtn.closest('div')).toHaveStyle({ display: 'none' })
  })
})
