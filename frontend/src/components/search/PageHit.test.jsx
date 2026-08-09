import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useSearchParams } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
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

  // The reader's back button returns to whatever `from` holds, and PageHit is
  // the only card that captures the query string as well as the path — the
  // search results it returns to are identified by `?q=`.
  describe('`from` state for the reader back button', () => {
    // Reports the state PageHit's link actually carries, plus a control to
    // change `?q=` the way SearchView does (setSearchParams + replace).
    function Harness() {
      const location = useLocation()
      const [, setSearchParams] = useSearchParams()
      return (
        <>
          <button onClick={() => setSearchParams({ q: 'wraith' }, { replace: true })}>
            change query
          </button>
          <span data-testid="state-from">{location.state?.from ?? 'none'}</span>
          <PageHit bookId="b7" page={page} />
        </>
      )
    }

    const renderHarness = (initialEntry) =>
      render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <Harness />
        </MemoryRouter>
      )

    it('carries the path and query of the results it was opened from', async () => {
      renderHarness('/search?q=lich')

      await userEvent.click(screen.getByRole('link', { name: 'p. 12' }))

      expect(screen.getByTestId('state-from')).toHaveTextContent('/search?q=lich')
    })

    // Regression guard for the render-time capture: `from` comes from
    // useLocation() during render, not from window.location at click time, so
    // it is only correct while PageHit re-renders on navigation. Memoizing the
    // card (or hoisting the capture to a parent) would freeze `from` at its
    // mount value and land the back button on stale results.
    it('reflects the current query after the search is refined, not the one at mount', async () => {
      renderHarness('/search?q=lich')

      await userEvent.click(screen.getByRole('button', { name: 'change query' }))
      await userEvent.click(screen.getByRole('link', { name: 'p. 12' }))

      expect(screen.getByTestId('state-from')).toHaveTextContent('/search?q=wraith')
    })
  })
})
