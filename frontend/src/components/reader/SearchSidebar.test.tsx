import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchSidebar from './SearchSidebar'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn() },
}))

function renderSidebar(overrides = {}) {
  const props = {
    bookId: 'book-1',
    onGoToPage: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  return { ...render(<SearchSidebar {...props} />), props }
}

describe('SearchSidebar', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders the search input', () => {
    renderSidebar()
    expect(screen.getByPlaceholderText('Search this book…')).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    const { props } = renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: 'Close search' }))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('shows prompt text when query is too short', () => {
    renderSidebar()
    expect(screen.getByText('Type to search within this book.')).toBeInTheDocument()
  })

  it('calls the search API after typing at least 2 characters', async () => {
    api.get.mockResolvedValue({ total: 0, results: [] })
    renderSidebar()

    await userEvent.type(screen.getByPlaceholderText('Search this book…'), 'fi')

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/search?q=fi'))
    )
  })

  it('does not call the API when query is only 1 character', async () => {
    renderSidebar()
    await userEvent.type(screen.getByPlaceholderText('Search this book…'), 'x')
    // Short debounce — still no call
    expect(api.get).not.toHaveBeenCalled()
  })

  it('shows "No results found" when API returns empty results', async () => {
    api.get.mockResolvedValue({ total: 0, results: [] })
    renderSidebar()

    await userEvent.type(screen.getByPlaceholderText('Search this book…'), 'xyz')

    await waitFor(() => expect(screen.getByText('No results found.')).toBeInTheDocument())
  })

  it('renders search results with page numbers', async () => {
    api.get.mockResolvedValue({
      total: 1,
      results: [{ page_number: 42, snippet: 'some text here' }],
    })
    renderSidebar()

    await userEvent.type(screen.getByPlaceholderText('Search this book…'), 'text')

    await waitFor(() => expect(screen.getByText('p. 42')).toBeInTheDocument())
    expect(screen.getByText('some text here')).toBeInTheDocument()
  })

  it('calls onGoToPage with the correct page and query when a result is clicked', async () => {
    api.get.mockResolvedValue({
      total: 1,
      results: [{ page_number: 7, snippet: 'matching text' }],
    })
    const { props } = renderSidebar()

    await userEvent.type(screen.getByPlaceholderText('Search this book…'), 'match')
    await waitFor(() => screen.getByText('p. 7'))

    fireEvent.click(screen.getByText('p. 7').closest('button'))

    expect(props.onGoToPage).toHaveBeenCalledWith(7, 'match')
  })

  it('renders <mark> tags as highlighted elements, not as raw HTML', async () => {
    api.get.mockResolvedValue({
      total: 1,
      results: [{ page_number: 1, snippet: 'some <mark>highlighted</mark> word' }],
    })
    renderSidebar()

    await userEvent.type(screen.getByPlaceholderText('Search this book…'), 'high')
    await waitFor(() => screen.getByText('highlighted'))

    const mark = screen.getByText('highlighted')
    expect(mark.tagName).toBe('MARK')
    // Ensure the raw string is not rendered as literal text
    expect(screen.queryByText('<mark>highlighted</mark>')).toBeNull()
  })

  it('does not render injected script tags from snippet content', async () => {
    api.get.mockResolvedValue({
      total: 1,
      results: [{ page_number: 1, snippet: '<script>alert(1)</script> text' }],
    })
    renderSidebar()

    await userEvent.type(screen.getByPlaceholderText('Search this book…'), 'te')
    await waitFor(() => screen.getByText('p. 1'))

    // The raw script tag text should appear as plain text, not a DOM element
    expect(document.querySelector('script[data-injected]')).toBeNull()
    // The literal text should be visible as-is (escaped)
    expect(screen.getByText('<script>alert(1)</script> text')).toBeInTheDocument()
  })
})
