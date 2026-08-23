import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k === 'maintenance.dupes.promoteWarning') return `${o.count} variants will move`
      if (k === 'maintenance.dupes.linkExplainer') return `${o.child} under ${o.parent}`
      return k
    },
  }),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ resourceType: 'book' }),
  useSearchParams: () => [new URLSearchParams('left=a&right=b')],
}))

let role = 'admin'
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }))

const compare = vi.fn()
const link = vi.fn()
const promote = vi.fn()
const dismiss = vi.fn()
const deleteItem = vi.fn()
const mergeMetadata = vi.fn()

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  bookPageUrl: (id, page) => `/page/${id}/${page}`,
  // Named to match the real module. Note this does not *verify* the import:
  // a factory mock replaces the module wholesale, so a wrong export name still
  // passes here and only fails the production build. Kept accurate so the mock
  // does not mislead the next reader about what the real api.js offers.
  imageSources: { thumbUrl: (t, id) => `/thumb/${id}` },
  duplicates: {
    compare: (...a) => compare(...a),
    link: (...a) => link(...a),
    promote: (...a) => promote(...a),
    dismiss: (...a) => dismiss(...a),
    deleteItem: (...a) => deleteItem(...a),
    mergeMetadata: (...a) => mergeMetadata(...a),
  },
}))

import DuplicateCompareView from './DuplicateCompareView'

const item = (id, extra = {}) => ({
  id,
  filename: `${id}.pdf`,
  relative_path: `books/${id}.pdf`,
  file_size: 1048576,
  page_count: 10,
  reference_counts: {},
  variants: [],
  ...extra,
})

const payload = (extra = {}) => ({
  resource_type: 'book',
  items: [item('a'), item('b')],
  differences: [
    { field: 'title', values: ['One', 'Two'], same: false },
    { field: 'isbn', values: ['X', 'X'], same: true },
  ],
  page_count_min: 10,
  suggested_parent_id: 'a',
  ...extra,
})

describe('DuplicateCompareView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    role = 'admin'
    compare.mockResolvedValue(payload())
    link.mockResolvedValue({ linked: ['b'] })
    promote.mockResolvedValue({ moved: 2 })
    dismiss.mockResolvedValue({})
    deleteItem.mockResolvedValue({})
    mergeMetadata.mockResolvedValue({ updated: ['title'] })
  })

  it('refuses non-admins without calling the API', () => {
    role = 'player'
    render(<DuplicateCompareView />)
    expect(screen.getByText('maintenance.dupes.adminOnly')).toBeInTheDocument()
    expect(compare).not.toHaveBeenCalled()
  })

  it('requests exactly the two ids in the URL', async () => {
    render(<DuplicateCompareView />)
    await waitFor(() => expect(compare).toHaveBeenCalledWith('book', ['a', 'b']))
  })

  it('shows both copies and the field diff', async () => {
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())
    expect(screen.getByText('b.pdf')).toBeInTheDocument()
    expect(screen.getByText('One')).toBeInTheDocument()
    expect(screen.getByText('Two')).toBeInTheDocument()
  })

  it("seeds the parent from the server's suggestion", async () => {
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getAllByRole('radio')[0]).toBeChecked())
  })

  it('links the non-parent as a variant with the chosen kind and label', async () => {
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByRole('combobox'), 'form-fillable')
    await userEvent.type(screen.getByRole('textbox'), 'v2')
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.linkAs/ }))

    expect(link).toHaveBeenCalledWith('book', 'a', [
      { id: 'b', kind: 'form-fillable', label: 'v2' },
    ])
  })

  it('lets the user re-elect the parent, reversing the link', async () => {
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('radio')[1])
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.linkAs/ }))

    // b is now the main version and a is filed under it.
    expect(link).toHaveBeenCalledWith('book', 'b', [{ id: 'a', kind: 'other', label: '' }])
  })

  it('swaps the parent from the toolbar button', async () => {
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.swapParent/ }))
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.linkAs/ }))

    expect(link).toHaveBeenCalledWith('book', 'b', [{ id: 'a', kind: 'other', label: '' }])
  })

  it('promotes instead of linking when the demoted copy already has a family', async () => {
    // The scenario that plain `link` cannot express: b is already the main
    // version of its own variants, and the user wants a to take over.
    compare.mockResolvedValue(
      payload({ items: [item('a'), item('b', { variants: [{ id: 'c' }, { id: 'd' }] })] })
    )
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())

    expect(screen.getByText('2 variants will move')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.linkAs/ }))
    expect(promote).toHaveBeenCalledWith('book', {
      newParentId: 'a',
      oldParentId: 'b',
      kind: 'other',
      label: '',
    })
    expect(link).not.toHaveBeenCalled()
  })

  it('dismisses the pair', async () => {
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.dismiss/ }))
    expect(dismiss).toHaveBeenCalledWith('book', ['a', 'b'])
  })

  it('returns to the list after a decision', async () => {
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.linkAs/ }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/settings/duplicates'))
  })

  it('deletes from disk by default', async () => {
    // Someone resolving duplicates has decided this copy is redundant; leaving
    // the bytes behind means the next scan proposes the same pair again.
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: /deleteThis/ })[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /common.delete/ }))

    expect(deleteItem).toHaveBeenCalledWith('book', 'a', { deleteFile: true, reparentTo: '' })
  })

  it('can still delete the record only', async () => {
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: /deleteThis/ })[0])
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /common.delete/ }))

    expect(deleteItem).toHaveBeenCalledWith('book', 'a', { deleteFile: false, reparentTo: '' })
  })

  it('dismisses the delete dialog on cancel without deleting', async () => {
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: /deleteThis/ })[0])
    await userEvent.click(screen.getByRole('button', { name: /common.cancel/ }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteItem).not.toHaveBeenCalled()
  })

  it('copies chosen metadata from the discarded copy onto the one being kept', async () => {
    compare.mockResolvedValue(
      payload({
        mergeable_fields: ['title', 'publisher'],
        differences: [
          { field: 'title', values: ['One', 'Two'], same: false },
          { field: 'publisher', values: ['P', 'P'], same: true },
        ],
      })
    )
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())

    // Only the differing field is offered — copying onto an identical value is
    // a no-op the user should not have to reason about.
    const boxes = screen.getAllByRole('checkbox')
    await userEvent.click(boxes[boxes.length - 1])
    await userEvent.click(screen.getByRole('button', { name: /copySelected/ }))

    expect(mergeMetadata).toHaveBeenCalledWith({
      resource_type: 'book',
      source_id: 'b',
      target_id: 'a',
      fields: ['title'],
      overwrite: true,
    })
  })

  it('surfaces a failed action without navigating away', async () => {
    link.mockRejectedValue(new Error('nope'))
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.linkAs/ }))
    await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument())
    expect(navigate).not.toHaveBeenCalled()
  })

  it('reports a comparison it could not load', async () => {
    compare.mockRejectedValue(new Error('gone'))
    render(<DuplicateCompareView />)
    await waitFor(() => expect(screen.getByText('gone')).toBeInTheDocument())
  })
})
