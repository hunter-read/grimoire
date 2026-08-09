import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PageHit from './PageHit'

const page = { page_number: 12, snippet: 'the <b>lich</b> waits' }

describe('PageHit', () => {
  let open

  beforeEach(() => {
    open = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    open.mockRestore()
  })

  it('renders the page number and snippet markup', () => {
    render(<PageHit bookId="b7" page={page} onOpen={vi.fn()} />)

    expect(screen.getByText('p. 12')).toBeInTheDocument()
    expect(screen.getByText('lich')).toBeInTheDocument()
  })

  it('opens the page in place on a plain click', async () => {
    const onOpen = vi.fn()
    render(<PageHit bookId="b7" page={page} onOpen={onOpen} />)

    await userEvent.click(screen.getByText('p. 12'))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the reader at that page in a new tab on middle click', async () => {
    const onOpen = vi.fn()
    render(<PageHit bookId="b7" page={page} onOpen={onOpen} />)

    await userEvent.pointer({ target: screen.getByText('p. 12'), keys: '[MouseMiddle]' })

    expect(open).toHaveBeenCalledWith('/library/book/b7?page=12', '_blank', 'noopener,noreferrer')
    expect(onOpen).not.toHaveBeenCalled()
  })
})
