import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import useRestoredView from './useRestoredView'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate }
})

function Probe() {
  const restore = useRestoredView()
  return <span data-testid="restore">{String(restore)}</span>
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe />
    </MemoryRouter>
  )
}

describe('useRestoredView', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is false for a plain navigation', () => {
    renderAt({ pathname: '/library/system/s1', state: null })
    expect(screen.getByTestId('restore')).toHaveTextContent('false')
  })

  it('is true when the route carries the restoreView flag', () => {
    renderAt({ pathname: '/library/system/s1', state: { restoreView: true } })
    expect(screen.getByTestId('restore')).toHaveTextContent('true')
  })

  it('strips the flag from history so a reload counts as fresh', async () => {
    renderAt({ pathname: '/library/system/s1', state: { restoreView: true } })
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/library/system/s1', {
        replace: true,
        state: null,
      })
    )
  })

  it('preserves other location state when stripping the flag', async () => {
    renderAt({
      pathname: '/library/system/s1',
      state: { restoreView: true, from: '/library' },
    })
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/library/system/s1', {
        replace: true,
        state: { from: '/library' },
      })
    )
  })

  it('does not touch history when there is no flag', async () => {
    renderAt({ pathname: '/library/system/s1', state: null })
    await waitFor(() => expect(mockNavigate).not.toHaveBeenCalled())
  })
})
