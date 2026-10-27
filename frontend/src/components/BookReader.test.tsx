import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import BookReader from './BookReader'

// The stub counts its own mounts: a remount runs the effect again, a re-render does not.
const mounts = vi.fn()
vi.mock('../views/ReaderView', () => ({
  default: function ReaderViewStub() {
    const { bookId } = useParams()
    useEffect(() => {
      mounts()
    }, [])
    return <div data-testid="reader">book {bookId}</div>
  },
}))

function NextBook() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/books/2')}>next</button>
}

describe('BookReader', () => {
  it('remounts the reader when the book changes', async () => {
    render(
      <MemoryRouter initialEntries={['/books/1']}>
        <Routes>
          <Route
            path="/books/:bookId"
            element={
              <>
                <NextBook />
                <BookReader />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('reader')).toHaveTextContent('book 1')
    expect(mounts).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'next' }))

    expect(await screen.findByText('book 2')).toBeInTheDocument()
    await waitFor(() => expect(mounts).toHaveBeenCalledTimes(2))
  })
})
