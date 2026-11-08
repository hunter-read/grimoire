import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PublicationLinksPanel from './PublicationLinksPanel'
import PublicationLinkRow from './PublicationLinkRow'
import { army } from '../../test/armyFixtures'

const mockPublications = vi.fn()
const mockSetLink = vi.fn()
const mockRemoveLink = vi.fn()
const mockSearch = vi.fn()

vi.mock('../../api', () => ({
  armies: {
    publications: (...a: unknown[]) => mockPublications(...a),
    setLink: (...a: unknown[]) => mockSetLink(...a),
    removeLink: (...a: unknown[]) => mockRemoveLink(...a),
    searchBooks: (...a: unknown[]) => mockSearch(...a),
  },
}))

const unlinked = {
  publication: 'Codex: Necrons',
  link: null,
  suggestions: [{ book_id: 'b1', title: 'Codex: Necrons' }],
}
const linked = {
  publication: 'Codex: Necrons',
  link: { book_id: 'b9', book_title: 'Old Codex', page_offset: 2 },
  suggestions: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSetLink.mockResolvedValue({})
  mockRemoveLink.mockResolvedValue(undefined)
})

describe('PublicationLinksPanel', () => {
  it('links a cited publication to the suggested book, then reloads', async () => {
    mockPublications.mockResolvedValue([unlinked])
    const onChanged = vi.fn()
    render(<PublicationLinksPanel army={army} onChanged={onChanged} />)
    expect(await screen.findByText('Source books')).toBeInTheDocument()
    expect(screen.getByLabelText('Library book')).toHaveValue('b1')
    fireEvent.change(screen.getByLabelText('Page offset'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(mockSetLink).toHaveBeenCalledWith({
      system_name: 'Warhammer 40,000 10th Edition',
      publication: 'Codex: Necrons',
      book_id: 'b1',
      page_offset: 3,
    })
    expect(mockPublications).toHaveBeenCalledTimes(2)
  })

  it('unlinks, keeping the linked book among the choices', async () => {
    mockPublications.mockResolvedValue([linked])
    const onChanged = vi.fn()
    render(<PublicationLinksPanel army={army} onChanged={onChanged} />)
    expect(await screen.findByRole('option', { name: 'Old Codex' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(mockRemoveLink).toHaveBeenCalledWith('Warhammer 40,000 10th Edition', 'Codex: Necrons')
  })

  it('shows nothing when the lookup fails', async () => {
    mockPublications.mockRejectedValue(new Error('offline'))
    const { container } = render(<PublicationLinksPanel army={army} onChanged={vi.fn()} />)
    await waitFor(() => expect(mockPublications).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe('PublicationLinkRow', () => {
  const renderRow = (item = { ...unlinked, suggestions: [] as typeof unlinked.suggestions }) => {
    const onLink = vi.fn().mockResolvedValue(undefined)
    const onUnlink = vi.fn().mockResolvedValue(undefined)
    render(
      <ul>
        <PublicationLinkRow item={item} onLink={onLink} onUnlink={onUnlink} />
      </ul>
    )
    return { onLink, onUnlink }
  }

  it('searches titles and picks the first match', async () => {
    mockSearch.mockResolvedValue([{ book_id: 'b2', title: 'Index: Xenos' }])
    const { onLink } = renderRow()
    expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled()
    const box = screen.getByLabelText('Search book titles')
    fireEvent.change(box, { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(mockSearch).not.toHaveBeenCalled() // too short
    fireEvent.change(box, { target: { value: ' Index ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('option', { name: 'Index: Xenos' })).toBeInTheDocument()
    expect(mockSearch).toHaveBeenCalledWith('Index')
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(onLink).toHaveBeenCalledWith('Codex: Necrons', 'b2', 0))
  })

  it('says when nothing matches, and shows failures', async () => {
    mockSearch.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('GM only'))
    const { onLink } = renderRow({ ...unlinked })
    const box = screen.getByLabelText('Search book titles')
    fireEvent.change(box, { target: { value: 'zzz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('No books match that title')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('GM only')
    onLink.mockRejectedValueOnce(new Error('Book not found'))
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    expect(await screen.findByText('Book not found')).toBeInTheDocument()
  })
})
