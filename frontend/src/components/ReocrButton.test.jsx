import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ReocrButton from './ReocrButton'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

const mockPost = vi.fn(() => Promise.resolve({}))
vi.mock('../api', () => ({
  default: {
    post: (...args) => mockPost(...args),
  },
}))

function renderBtn(book = {}) {
  return render(<ReocrButton book={{ id: 'b1', ...book }} />)
}

describe('ReocrButton', () => {
  beforeEach(() => {
    mockPost.mockClear()
    mockPost.mockResolvedValue({})
  })

  it('opens a DPI popover on click', () => {
    renderBtn()
    expect(screen.queryByText('reocr.run')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('reocr.button'))
    expect(screen.getByText('reocr.run')).toBeInTheDocument()
  })

  it('portals the popover to document.body so it escapes the row clip', () => {
    const { container } = renderBtn()
    fireEvent.click(screen.getByLabelText('reocr.button'))
    // The popover renders outside the component's own DOM subtree (into body).
    expect(container.querySelector('input[type="number"]')).toBeNull()
    const popover = screen.getByLabelText('reocr.dpiLabel')
    expect(popover.closest('div[style*="position: fixed"]')).not.toBeNull()
  })

  it('posts with no DPI when the field is left blank', async () => {
    renderBtn({ id: 'b2' })
    fireEvent.click(screen.getByLabelText('reocr.button'))
    fireEvent.click(screen.getByText('reocr.run'))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/books/b2/reindex'))
    expect(screen.getByText(/reocr.queued/)).toBeInTheDocument()
  })

  it('posts the entered DPI as a query param', async () => {
    renderBtn({ id: 'b3' })
    fireEvent.click(screen.getByLabelText('reocr.button'))
    fireEvent.change(screen.getByLabelText('reocr.dpiLabel'), { target: { value: '300' } })
    fireEvent.click(screen.getByText('reocr.run'))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/books/b3/reindex?ocr_dpi=300'))
  })

  it('seeds the DPI field from an existing per-book override', () => {
    renderBtn({ id: 'b4', ocr_dpi: 250 })
    fireEvent.click(screen.getByLabelText('reocr.button'))
    expect(screen.getByLabelText('reocr.dpiLabel')).toHaveValue(250)
  })

  it('shows an error when the request fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('boom'))
    renderBtn({ id: 'b5' })
    fireEvent.click(screen.getByLabelText('reocr.button'))
    fireEvent.click(screen.getByText('reocr.run'))
    await waitFor(() => expect(screen.getByText('reocr.error')).toBeInTheDocument())
  })
})
