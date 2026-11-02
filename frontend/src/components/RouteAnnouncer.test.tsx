import { describe, it, expect, beforeEach } from 'vitest'
import { useRef } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Link, Routes, Route } from 'react-router-dom'
import RouteAnnouncer from './RouteAnnouncer'
import usePageTitle, { APP_TITLE } from '../hooks/usePageTitle'

function Page({ title, children }: { title: string | null; children?: React.ReactNode }) {
  usePageTitle(title)
  return <>{children}</>
}

/** A sidebar link outside <main>, and pages inside it that link to each other. */
function Shell() {
  const mainRef = useRef<HTMLElement>(null)
  return (
    <>
      <RouteAnnouncer mainRef={mainRef} />
      <nav>
        <Link to="/b">Sidebar to B</Link>
      </nav>
      <main ref={mainRef} tabIndex={-1} data-testid="main">
        <Routes>
          <Route
            path="/a"
            element={
              <Page title="Alpha">
                <Link to="/b">Card to B</Link>
              </Page>
            }
          />
          <Route path="/b" element={<Page title="Beta" />} />
          <Route path="/untitled" element={<Page title={null} />} />
          <Route
            path="/tabs/:tab"
            element={
              <Page title="Tabs">
                <Link to="/tabs/two">Tab two</Link>
              </Page>
            }
          />
        </Routes>
      </main>
    </>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Shell />
      <Link to="/untitled">Go untitled</Link>
    </MemoryRouter>
  )
}

const status = () => screen.getByRole('status')

describe('RouteAnnouncer', () => {
  beforeEach(() => {
    document.title = APP_TITLE
  })

  it('says nothing on the first page load', () => {
    renderAt('/a')
    expect(status()).toHaveTextContent('')
  })

  it('reads the new page title out after a navigation', async () => {
    renderAt('/a')
    fireEvent.click(screen.getByText('Card to B'))
    await waitFor(() => expect(status()).toHaveTextContent('Beta - Grimoire'))
  })

  it('moves focus to main when the clicked element went away with its page', async () => {
    renderAt('/a')
    const card = screen.getByText('Card to B')
    card.focus()
    fireEvent.click(card)
    await waitFor(() => expect(screen.getByTestId('main')).toHaveFocus())
  })

  it('moves focus to main from a link outside it', async () => {
    renderAt('/a')
    const sidebar = screen.getByText('Sidebar to B')
    sidebar.focus()
    fireEvent.click(sidebar)
    await waitFor(() => expect(screen.getByTestId('main')).toHaveFocus())
  })

  it('leaves focus on a control inside main that survived the change', async () => {
    renderAt('/tabs/one')
    // Let the title observer see the page's title before the user acts on it.
    await act(async () => {})
    const tab = screen.getByText('Tab two')
    tab.focus()
    fireEvent.click(tab)
    await waitFor(() => expect(status()).toHaveTextContent(''))
    expect(tab).toHaveFocus()
  })

  it('does not announce the bare app name', async () => {
    renderAt('/a')
    fireEvent.click(screen.getByText('Go untitled'))
    await waitFor(() => expect(document.title).toBe(APP_TITLE))
    expect(status()).toHaveTextContent('')
  })

  it('announces a title that arrives after the navigation', async () => {
    renderAt('/a')
    fireEvent.click(screen.getByText('Go untitled'))
    // The view names itself later, once its data has loaded.
    act(() => {
      document.title = 'Late - Grimoire'
    })
    await waitFor(() => expect(status()).toHaveTextContent('Late - Grimoire'))
  })
})
