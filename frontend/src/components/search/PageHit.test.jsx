import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PageHit from './PageHit'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k === 'common.pagePrefixed') return `p. ${o.page}`
      return k
    },
  }),
}))

const page = { page_number: 12, snippet: 'the <b>lich</b> waits' }

const renderHit = (props) =>
  render(
    <MemoryRouter>
      <PageHit {...props} />
    </MemoryRouter>
  )

describe('PageHit', () => {
  it('renders the page number and snippet markup', () => {
    renderHit({ bookId: 'b7', page })

    expect(screen.getByText('p. 12')).toBeInTheDocument()
    expect(screen.getByText('lich')).toBeInTheDocument()
  })

  // PageHit is now a real <Link> via CardLink — assert the href rather than an
  // onOpen spy. Plain click navigates in-place via the router; middle click and
  // ctrl/cmd-click open a new tab natively.
  it('renders a link to the reader at the given page', () => {
    renderHit({ bookId: 'b7', page })

    const link = screen.getByRole('link', { name: 'p. 12' })
    expect(link.getAttribute('href')).toBe('/library/book/b7?page=12')
  })

  // Middle-click opens a new tab natively — no JS needed, just verify the href.
  it('is a real anchor so middle click opens the reader in a new tab natively', () => {
    renderHit({ bookId: 'b7', page })

    const link = screen.getByRole('link', { name: 'p. 12' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/library/book/b7?page=12')
  })
})
