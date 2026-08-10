import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CoverPicker from './CoverPicker'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts?.count !== undefined ? `${k}:${opts.count}` : k),
  }),
}))

vi.mock('../../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))
vi.mock('../LazyImg', () => ({
  default: ({ alt, ...rest }) => <img alt={alt} {...rest} />,
}))

const books = (n, category = 'core') =>
  Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    title: `Book ${String(i).padStart(2, '0')}`,
    category,
    has_thumbnail: true,
  }))

describe('CoverPicker', () => {
  it('renders nothing when no book has a thumbnail', () => {
    const { container } = render(
      <CoverPicker
        books={[{ id: 'x', title: 'X', category: 'core', has_thumbnail: false }]}
        value={null}
        onChange={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  // Collapsing to nothing and then expanding once the books arrive is what
  // pushed the bulk-edit modal's buttons down under the cursor.
  it('holds its space while books are still loading', () => {
    const { container } = render(<CoverPicker books={[]} value={null} onChange={vi.fn()} loading />)
    expect(container).not.toBeEmptyDOMElement()
    expect(screen.getByText('systemEditor.coverImage')).toBeInTheDocument()
  })

  it('collapses once loading finishes with nothing to show', () => {
    const { container } = render(<CoverPicker books={[]} value={null} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the whole list when it is short', () => {
    render(<CoverPicker books={books(4)} value={null} onChange={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /Book/ })).toHaveLength(4)
  })

  describe('paging', () => {
    it('shows only the first ten of a long list', () => {
      // A system can have hundreds of books; rendering them all is unusable.
      render(<CoverPicker books={books(25)} value={null} onChange={vi.fn()} />)
      expect(screen.getAllByRole('button', { name: /Book/ })).toHaveLength(10)
    })

    it('offers to load the rest', () => {
      render(<CoverPicker books={books(25)} value={null} onChange={vi.fn()} />)
      expect(screen.getByText('systemEditor.loadMoreCovers:15')).toBeInTheDocument()
    })

    it('reveals another page on click', async () => {
      const user = userEvent.setup()
      render(<CoverPicker books={books(25)} value={null} onChange={vi.fn()} />)
      await user.click(screen.getByText('systemEditor.loadMoreCovers:15'))
      expect(screen.getAllByRole('button', { name: /Book/ })).toHaveLength(20)
    })

    it('hides the button once everything is shown', async () => {
      const user = userEvent.setup()
      render(<CoverPicker books={books(12)} value={null} onChange={vi.fn()} />)
      await user.click(screen.getByText('systemEditor.loadMoreCovers:2'))
      expect(screen.queryByText(/loadMoreCovers/)).toBeNull()
    })

    // The bulk-edit modal is narrower and asks for a smaller page.
    it('honours a caller-supplied page size', () => {
      render(<CoverPicker books={books(25)} value={null} onChange={vi.fn()} pageSize={8} />)
      expect(screen.getAllByRole('button', { name: /Book/ })).toHaveLength(8)
      expect(screen.getByText('systemEditor.loadMoreCovers:17')).toBeInTheDocument()
    })

    it('pages by the supplied size on each reveal', async () => {
      const user = userEvent.setup()
      render(<CoverPicker books={books(25)} value={null} onChange={vi.fn()} pageSize={8} />)
      await user.click(screen.getByText('systemEditor.loadMoreCovers:17'))
      expect(screen.getAllByRole('button', { name: /Book/ })).toHaveLength(16)
    })

    it('keeps the selected cover visible even when it sorts late', () => {
      const list = [...books(20, 'core'), { ...books(1, 'homebrew')[0], id: 'late' }]
      render(<CoverPicker books={list} value="late" onChange={vi.fn()} />)
      expect(screen.getByText('systemEditor.selected')).toBeInTheDocument()
    })
  })

  describe('selection', () => {
    it('selects a book', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<CoverPicker books={books(3)} value={null} onChange={onChange} />)
      await user.click(screen.getByRole('button', { name: 'Book 00' }))
      expect(onChange).toHaveBeenCalledWith('b0')
    })

    it('clicking the selected book clears it', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<CoverPicker books={books(3)} value="b0" onChange={onChange} />)
      await user.click(screen.getByRole('button', { name: 'Book 00' }))
      expect(onChange).toHaveBeenCalledWith(null)
    })

    it('clears via the clear link', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<CoverPicker books={books(3)} value="b0" onChange={onChange} />)
      await user.click(screen.getByText('systemEditor.clearCover'))
      expect(onChange).toHaveBeenCalledWith(null)
    })
  })

  describe('hover preview', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('does not appear immediately', () => {
      // Sweeping the cursor across the row should not flash previews.
      render(<CoverPicker books={books(3)} value={null} onChange={vi.fn()} />)
      fireEvent.mouseEnter(screen.getByRole('button', { name: 'Book 00' }))
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('appears after the delay', () => {
      render(<CoverPicker books={books(3)} value={null} onChange={vi.fn()} />)
      fireEvent.mouseEnter(screen.getByRole('button', { name: 'Book 00' }))
      act(() => vi.advanceTimersByTime(500))
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
    })

    it('is cancelled if the cursor leaves first', () => {
      render(<CoverPicker books={books(3)} value={null} onChange={vi.fn()} />)
      const target = screen.getByRole('button', { name: 'Book 00' })
      fireEvent.mouseEnter(target)
      act(() => vi.advanceTimersByTime(300))
      fireEvent.mouseLeave(target)
      act(() => vi.advanceTimersByTime(500))
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('shows a larger image than the thumbnail button', () => {
      render(<CoverPicker books={books(3)} value={null} onChange={vi.fn()} />)
      fireEvent.mouseEnter(screen.getByRole('button', { name: 'Book 00' }))
      act(() => vi.advanceTimersByTime(500))
      const preview = screen.getByRole('tooltip')
      expect(preview).toHaveAttribute('aria-label', 'Book 00')
      expect(preview.querySelector('img')).toHaveStyle({ width: '220px' })
    })

    it('appears immediately on keyboard focus', () => {
      // A keyboard user has already committed to the element; no delay needed.
      render(<CoverPicker books={books(3)} value={null} onChange={vi.fn()} />)
      fireEvent.focus(screen.getByRole('button', { name: 'Book 00' }))
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
    })

    it('closes on blur', () => {
      render(<CoverPicker books={books(3)} value={null} onChange={vi.fn()} />)
      const target = screen.getByRole('button', { name: 'Book 00' })
      fireEvent.focus(target)
      fireEvent.blur(target)
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('does not fire after unmount', () => {
      // A pending timer would set state on a gone component.
      const { unmount } = render(<CoverPicker books={books(3)} value={null} onChange={vi.fn()} />)
      fireEvent.mouseEnter(screen.getByRole('button', { name: 'Book 00' }))
      unmount()
      expect(() => act(() => vi.advanceTimersByTime(1000))).not.toThrow()
    })
  })
})
