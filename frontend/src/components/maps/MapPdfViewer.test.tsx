import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MapPdfViewer from './MapPdfViewer'

import { saveBookPrefs } from '../../hooks/useBookPrefs'
vi.mock('../../api', () => ({
  // Page sizes for the export panel's cut-out stage.
  default: { get: vi.fn(() => Promise.resolve({ width: 600, height: 800 })) },
  mediaUrl: (p: string, params?: Record<string, string>) => {
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
  default: ({
    currentPage,
    pageUrl,
  }: {
    currentPage: number
    pageUrl: (p: number, w: number) => string
  }) => <div data-testid="single-page">{pageUrl(currentPage, 1600)}</div>,
}))
vi.mock('../reader/SpreadPage', () => ({
  default: ({
    currentPage,
    rightPage,
    hasRight,
    pageUrl,
    joined,
  }: {
    currentPage: number
    rightPage: number
    hasRight: boolean
    pageUrl: (p: number, w: number) => string
    joined?: boolean
  }) => (
    <div data-testid="spread-page" data-joined={joined ? 'yes' : 'no'}>
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

  it('joins the spread pages, remembered for this map', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /spread/i }))
    expect(screen.getByTestId('spread-page')).toHaveAttribute('data-joined', 'no')
    const join = screen.getByRole('button', { name: /join pages/i })
    expect(join).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(join)
    expect(screen.getByTestId('spread-page')).toHaveAttribute('data-joined', 'yes')
    expect(join).toHaveAttribute('aria-pressed', 'true')
    expect(saveBookPrefs).toHaveBeenCalledWith('map:m1', { joinSpread: true })
  })

  it('offers joining only in spread mode', () => {
    setup()
    expect(screen.queryByRole('button', { name: /join pages/i })).not.toBeInTheDocument()
  })

  it('renders the raw PDF in an iframe in pdf mode', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^pdf$/i }))
    const frame = document.querySelector('iframe')
    expect(frame).toBeInTheDocument()
    expect(frame!.getAttribute('src')).toBe('/api/maps/m1/file#page=1')
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

  it('opens the export panel from the toolbar, on the page being viewed', async () => {
    setup({ relativePath: 'maps/dungeon.pdf' })
    await userEvent.click(screen.getByRole('button', { name: /next page/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getByLabelText('Pages')).toHaveValue('2')
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.queryByLabelText('Pages')).not.toBeInTheDocument()
  })

  it('leaves the raw PDF view for pages when export opens', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /^pdf$/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(document.querySelector('iframe')).not.toBeInTheDocument()
    expect(screen.getByTestId('single-page')).toBeInTheDocument()
  })

  it('swaps the page for the cut-out stage on the Cut out tab', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Cut out' }))
    expect(await screen.findByTestId('cutout-stage')).toBeInTheDocument()
    expect(screen.getByTestId('single-page').parentElement).toHaveStyle({ display: 'none' })

    await userEvent.click(screen.getByRole('button', { name: 'Close export' }))
    expect(screen.queryByTestId('cutout-stage')).not.toBeInTheDocument()
  })
})
