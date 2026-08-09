import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SystemPageHit from './SystemPageHit'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k === 'common.pagePrefixed') return `p. ${o.page}`
      return k
    },
  }),
}))

const result = {
  id: 'book-1',
  title: 'Player Handbook',
  page_number: 42,
  snippet: 'a <b>dragon</b> appears',
}

const renderHit = (props) =>
  render(
    <MemoryRouter>
      <SystemPageHit {...props} />
    </MemoryRouter>
  )

describe('SystemPageHit', () => {
  it('renders the book title, page number and snippet markup', () => {
    renderHit({ result })

    expect(screen.getByText('Player Handbook')).toBeInTheDocument()
    expect(screen.getByText('p. 42')).toBeInTheDocument()
    expect(screen.getByText('dragon')).toBeInTheDocument()
  })

  // SystemPageHit is now a real <Link> via CardLink — assert the href rather
  // than an onOpen spy. Plain click navigates in-place; middle/ctrl-click is native.
  it('renders a link to the reader at the given page', () => {
    renderHit({ result })

    const link = screen.getByRole('link', { name: 'Player Handbook — p. 42' })
    expect(link.getAttribute('href')).toBe('/library/book/book-1?page=42')
  })

  // Middle-click opens a new tab natively — no JS needed, just verify the href.
  it('is a real anchor so middle click opens the reader in a new tab natively', () => {
    renderHit({ result })

    const link = screen.getByRole('link', { name: 'Player Handbook — p. 42' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/library/book/book-1?page=42')
  })
})
