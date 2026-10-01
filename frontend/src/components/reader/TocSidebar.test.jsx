import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TocSidebar from './TocSidebar'
import api from '../../api'

vi.mock('../../api', () => ({ default: { get: vi.fn() } }))

const node = (title, page, children = []) => ({ title, page, children })

// Two chapters; the first nests four levels deep.
const shortToc = [
  node('Chapter 1', 1, [node('Section 1.1', 2, [node('Detail 1.1.1', 3, [node('Note', 4)])])]),
  node('Chapter 2', 10, [node('Section 2.1', 11)]),
]

// Three chapters of nine sections each: 30 entries.
const longToc = [1, 2, 3].map((c) =>
  node(
    `Chapter ${c}`,
    c * 100,
    Array.from({ length: 9 }, (_, i) => node(`Section ${c}.${i}`, c * 100 + i))
  )
)

function renderToc(props = {}) {
  return render(
    <TocSidebar bookId="b1" currentPage={1} onGoToPage={vi.fn()} onClose={vi.fn()} {...props} />
  )
}

describe('TocSidebar', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens the top two levels of a short TOC', async () => {
    api.get.mockResolvedValue({ toc: shortToc })
    renderToc()
    expect(await screen.findByText('Section 1.1')).toBeInTheDocument()
    expect(screen.getByText('Detail 1.1.1')).toBeInTheDocument()
    // Entries from the third level down start closed.
    expect(screen.queryByText('Note')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expand Detail 1.1.1' }))
    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('collapses a long TOC to its chapters', async () => {
    api.get.mockResolvedValue({ toc: longToc })
    renderToc()
    expect(await screen.findByText('Chapter 1')).toBeInTheDocument()
    expect(screen.queryByText('Section 1.0')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand Chapter 2' }))
    expect(screen.getByText('Section 2.0')).toBeInTheDocument()
    expect(screen.queryByText('Section 1.0')).not.toBeInTheDocument()
  })

  it('jumps to an entry’s page and closes from the header', async () => {
    const onGoToPage = vi.fn()
    const onClose = vi.fn()
    api.get.mockResolvedValue({ toc: shortToc })
    renderToc({ onGoToPage, onClose })
    await userEvent.click(await screen.findByText('Chapter 2'))
    expect(onGoToPage).toHaveBeenCalledWith(10)
    await userEvent.click(screen.getByRole('button', { name: 'Close table of contents' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('says so when the book has no TOC, including when loading fails', async () => {
    api.get.mockRejectedValue(new Error('nope'))
    renderToc()
    await waitFor(() =>
      expect(screen.getByText('No table of contents in this PDF.')).toBeInTheDocument()
    )
  })
})
