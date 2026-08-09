import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SystemPageHit from './SystemPageHit'

const result = {
  id: 'book-1',
  title: 'Player Handbook',
  page_number: 42,
  snippet: 'a <b>dragon</b> appears',
}

describe('SystemPageHit', () => {
  let open

  beforeEach(() => {
    open = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    open.mockRestore()
  })

  it('renders the book title, page number and snippet markup', () => {
    render(<SystemPageHit result={result} onOpen={vi.fn()} />)

    expect(screen.getByText('Player Handbook')).toBeInTheDocument()
    expect(screen.getByText('p. 42')).toBeInTheDocument()
    expect(screen.getByText('dragon')).toBeInTheDocument()
  })

  it('opens the page in place on a plain click', async () => {
    const onOpen = vi.fn()
    render(<SystemPageHit result={result} onOpen={onOpen} />)

    await userEvent.click(screen.getByText('Player Handbook'))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the reader at that page in a new tab on middle click', async () => {
    const onOpen = vi.fn()
    render(<SystemPageHit result={result} onOpen={onOpen} />)

    await userEvent.pointer({ target: screen.getByText('Player Handbook'), keys: '[MouseMiddle]' })

    expect(open).toHaveBeenCalledWith(
      '/library/book/book-1?page=42',
      '_blank',
      'noopener,noreferrer'
    )
    expect(onOpen).not.toHaveBeenCalled()
  })
})
