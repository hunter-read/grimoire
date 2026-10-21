import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => {
      if (k === 'maintenance.dupes.review.counter') return `${o?.current} of ${o?.total}`
      if (k === 'maintenance.dupes.review.merge') return `merge ${o?.count}`
      if (k === 'maintenance.dupes.alreadyVariantBody') return `main=${o?.main}`
      return k
    },
  }),
}))

const navigate = vi.fn()
// Mutable so a test can open a queued group, or put the view on another
// collection's route.
let search = 'left=a&right=b'
let resourceType = 'book'
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ resourceType }),
  useSearchParams: () => [new URLSearchParams(search)],
}))

let role = 'admin'
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }))

const compare = vi.fn()
const merge = vi.fn()
const link = vi.fn()
const promote = vi.fn()
const dismiss = vi.fn()
const mergeMetadata = vi.fn()
const describeVariant = vi.fn()
const groups = vi.fn()

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  bookPageUrl: (id: string, page: number) => `/page/${id}/${page}`,
  imageSources: { thumbUrl: (_t: string, id: string) => `/thumb/${id}` },
  duplicates: {
    compare: (...a: unknown[]) => compare(...a),
    merge: (...a: unknown[]) => merge(...a),
    link: (...a: unknown[]) => link(...a),
    promote: (...a: unknown[]) => promote(...a),
    dismiss: (...a: unknown[]) => dismiss(...a),
    mergeMetadata: (...a: unknown[]) => mergeMetadata(...a),
    describe: (...a: unknown[]) => describeVariant(...a),
    groups: (...a: unknown[]) => groups(...a),
  },
}))

import DuplicateCompareView from './DuplicateCompareView'

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  filename: `${id}.pdf`,
  relative_path: `books/${id}.pdf`,
  file_size: 1048576,
  page_count: 10,
  reference_counts: {},
  variants: [],
  ...extra,
})

const payload = (ids: string[], extra: Record<string, unknown> = {}) => ({
  resource_type: 'book',
  items: ids.map((id) => item(id)),
  differences: [
    { field: 'title', values: ids.map((id) => id.toUpperCase()), same: false },
    { field: 'isbn', values: ids.map(() => 'X'), same: true },
  ],
  mergeable_fields: ['title', 'isbn'],
  page_count_min: 10,
  suggested_parent_id: ids[0],
  ...extra,
})

const member = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  filename: `${id}.pdf`,
  relative_path: `books/${id}.pdf`,
  file_size: 10,
  ...extra,
})

const group = (id: string, members: ReturnType<typeof member>[]) => ({
  id,
  resource_type: 'book',
  confidence: 1,
  reasons: ['metadata'],
  reason_text: 'similar title',
  members,
})

// The dry run echoes what it was asked, so a test can read the request off
// the summary the view shows.
const dryRun = (body: { keep_id: string; merge_ids: string[]; dry_run?: boolean }) => ({
  resource_type: 'book',
  keep_id: body.keep_id,
  merge_ids: body.merge_ids,
  dry_run: !!body.dry_run,
  items: [],
  fields: [],
  references: { bookmarks: { moved: 2, deduplicated: 0 } },
  files: [],
  warnings: [],
})

const lastDryRun = () =>
  merge.mock.calls
    .map((c) => c[0])
    .filter((b) => b.dry_run)
    .at(-1)
const realMerges = () => merge.mock.calls.map((c) => c[0]).filter((b) => !b.dry_run)

beforeEach(() => {
  vi.clearAllMocks()
  role = 'admin'
  resourceType = 'book'
  search = 'left=a&right=b'
  compare.mockImplementation(async (_t: string, ids: string[]) => payload(ids))
  merge.mockImplementation(async (body) => dryRun(body))
  link.mockResolvedValue({ linked: ['b'], errors: [] })
  promote.mockResolvedValue({ moved: 2 })
  dismiss.mockResolvedValue({})
  mergeMetadata.mockResolvedValue({ updated: ['title'] })
  describeVariant.mockResolvedValue({})
})

describe('DuplicateCompareView outside the queue', () => {
  it('refuses non-admins without calling the API', () => {
    role = 'player'
    render(<DuplicateCompareView />)
    expect(screen.getByText('maintenance.dupes.adminOnly')).toBeInTheDocument()
    expect(compare).not.toHaveBeenCalled()
  })

  it('compares the ids in the URL, keeping the suggested copy', async () => {
    search = 'ids=a,b,c'
    render(<DuplicateCompareView />)
    await waitFor(() => expect(compare).toHaveBeenCalledWith('book', ['a', 'b', 'c']))
    expect((await screen.findAllByText('c.pdf')).length).toBeGreaterThan(0)
    await waitFor(() => expect(lastDryRun()).toMatchObject({ keep_id: 'a', merge_ids: ['b', 'c'] }))
    expect(screen.getByText('maintenance.dupes.review.keeping')).toBeInTheDocument()
  })

  it('shows the dry run of the merge before it is confirmed', async () => {
    render(<DuplicateCompareView />)
    expect(await screen.findByText('merge.summary.movesHeading')).toBeInTheDocument()
    expect(realMerges()).toHaveLength(0)
  })

  it('merges into the keeper and returns to the list', async () => {
    render(<DuplicateCompareView />)
    await userEvent.click(await screen.findByRole('button', { name: /merge 1/ }))
    expect(realMerges()).toEqual([
      { resource_type: 'book', keep_id: 'a', merge_ids: ['b'], delete_files: false },
    ])
    expect(navigate).toHaveBeenCalledWith('/settings/duplicates')
  })

  it('deletes the other files only when asked', async () => {
    render(<DuplicateCompareView />)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'merge.deleteFiles' }))
    await waitFor(() => expect(lastDryRun().delete_files).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: /merge 1/ }))
    expect(realMerges()[0].delete_files).toBe(true)
  })

  it('picks a different keeper with a number key', async () => {
    render(<DuplicateCompareView />)
    await screen.findByText('b.pdf')
    await userEvent.keyboard('2')
    await waitFor(() => expect(lastDryRun()).toMatchObject({ keep_id: 'b', merge_ids: ['a'] }))
  })

  it('merges from the keyboard, but not while typing a label', async () => {
    render(<DuplicateCompareView />)
    await userEvent.type(
      await screen.findByPlaceholderText('maintenance.dupes.labelPlaceholder'),
      'm'
    )
    expect(realMerges()).toHaveLength(0)

    ;(document.activeElement as HTMLElement).blur()
    await userEvent.keyboard('m')
    await waitFor(() => expect(realMerges()).toHaveLength(1))
  })

  it('leaves a copy out of the merge', async () => {
    search = 'ids=a,b,c'
    render(<DuplicateCompareView />)
    const [first] = await screen.findAllByRole('checkbox', {
      name: 'maintenance.dupes.review.include',
    })
    await userEvent.click(first)
    await waitFor(() => expect(lastDryRun().merge_ids).toEqual(['c']))
  })

  it('has nothing to merge once every other copy is left out', async () => {
    render(<DuplicateCompareView />)
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'maintenance.dupes.review.include' })
    )
    expect(screen.getByText('maintenance.dupes.review.nothingIncluded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /merge 0/ })).toBeDisabled()
  })

  it('links the others as versions with their kind and label', async () => {
    render(<DuplicateCompareView />)
    const kind = await screen.findByRole('combobox', { name: 'maintenance.dupes.kindLabel' })
    await userEvent.selectOptions(kind, 'printer-friendly')
    await userEvent.type(screen.getByPlaceholderText('maintenance.dupes.labelPlaceholder'), 'B&W')
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.linkAs/ }))
    expect(link).toHaveBeenCalledWith(
      'book',
      'a',
      [{ id: 'b', kind: 'printer-friendly', label: 'B&W' }],
      { kind: '', label: '' }
    )
    expect(navigate).toHaveBeenCalledWith('/settings/duplicates')
  })

  it('promotes a copy that heads a family of its own instead of linking it', async () => {
    compare.mockImplementation(async (_t: string, ids: string[]) =>
      payload(ids, {
        items: [item('a'), item('b', { variants: [{ id: 'v' }] })],
      })
    )
    render(<DuplicateCompareView />)
    await userEvent.click(await screen.findByRole('button', { name: /maintenance.dupes.linkAs/ }))
    expect(link).not.toHaveBeenCalled()
    expect(promote).toHaveBeenCalledWith('book', {
      newParentId: 'a',
      oldParentId: 'b',
      kind: 'other',
      label: '',
    })
  })

  it('reports a refused link and stays on the page', async () => {
    link.mockResolvedValue({ linked: [], errors: [{ id: 'b', detail: 'Already a variant.' }] })
    render(<DuplicateCompareView />)
    await userEvent.click(await screen.findByRole('button', { name: /maintenance.dupes.linkAs/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Already a variant.')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('dismisses the copies as not duplicates', async () => {
    render(<DuplicateCompareView />)
    await screen.findByText('b.pdf')
    await userEvent.keyboard('d')
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith('book', ['a', 'b']))
  })

  it('surfaces a failed merge without navigating away', async () => {
    merge.mockImplementation(async (body) => {
      if (!body.dry_run) throw new Error('disk on fire')
      return dryRun(body)
    })
    render(<DuplicateCompareView />)
    await userEvent.click(await screen.findByRole('button', { name: /merge 1/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('disk on fire')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('copies chosen metadata from the copy being merged onto the keeper', async () => {
    render(<DuplicateCompareView />)
    await userEvent.click(
      await screen.findByRole('checkbox', { name: /maintenance.dupes.field.title/ })
    )
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.copySelected/ }))
    expect(mergeMetadata).toHaveBeenCalledWith({
      resource_type: 'book',
      source_id: 'b',
      target_id: 'a',
      fields: ['title'],
      overwrite: true,
    })
  })

  it('offers the copy that is a version of a third item a way out', async () => {
    compare.mockImplementation(async (_t: string, ids: string[]) =>
      payload(ids, {
        items: [
          item('a'),
          item('b', { variant_main: { id: 'm', filename: 'm.pdf', variant_count: 1 } }),
        ],
      })
    )
    render(<DuplicateCompareView />)
    expect(await screen.findByText('main=m.pdf')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: /maintenance.dupes.promoteOverFamily/ })
    )
    expect(promote).toHaveBeenCalledWith('book', {
      newParentId: 'a',
      oldParentId: 'm',
      kind: 'other',
      label: '',
    })
  })

  it("offers the collection's own kinds", async () => {
    resourceType = 'map'
    render(<DuplicateCompareView />)
    const kind = await screen.findByRole('combobox', { name: 'maintenance.dupes.kindLabel' })
    const values = within(kind)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
    expect(values).toContain('gridless')
    expect(values).not.toContain('form-fillable')
  })

  it('toggles the shortcut list with ?', async () => {
    render(<DuplicateCompareView />)
    await screen.findByText('b.pdf')
    await userEvent.keyboard('?')
    expect(
      screen.getByRole('region', { name: 'maintenance.dupes.review.shortcutsTitle' })
    ).toBeInTheDocument()
    await userEvent.keyboard('?')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})

describe('DuplicateCompareView as a review queue', () => {
  beforeEach(() => {
    groups.mockResolvedValue({
      groups: [
        group('g1', [member('a'), member('b', { page_count: 50 })]),
        group('g2', [member('c'), member('d')]),
        group('g3', [member('e'), member('f')]),
      ],
    })
  })

  it('shows where the group sits in the queue, keeping the better file', async () => {
    search = 'group=g1'
    render(<DuplicateCompareView />)
    expect(await screen.findByText('1 of 3')).toBeInTheDocument()
    // More pages beats the order the scan listed them in.
    await waitFor(() => expect(lastDryRun()).toMatchObject({ keep_id: 'b', merge_ids: ['a'] }))
  })

  it('moves straight on to the next group after a merge', async () => {
    search = 'group=g1'
    render(<DuplicateCompareView />)
    await userEvent.click(await screen.findByRole('button', { name: /merge 1/ }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/settings/duplicates/compare/book?group=g2')
    )
  })

  it('carries the list filters through the queue', async () => {
    search = 'group=g2&type=book&match=metadata'
    render(<DuplicateCompareView />)
    await screen.findByText('1 of 3'.replace('1', '2'))
    await userEvent.keyboard('s')
    expect(navigate).toHaveBeenCalledWith(
      '/settings/duplicates/compare/book?group=g3&type=book&match=metadata'
    )
  })

  it('skips forward and goes back from the keyboard', async () => {
    search = 'group=g2'
    render(<DuplicateCompareView />)
    await screen.findByText('2 of 3')
    await userEvent.keyboard('{ArrowRight}')
    expect(navigate).toHaveBeenLastCalledWith('/settings/duplicates/compare/book?group=g3')
    await userEvent.keyboard('{ArrowLeft}')
    expect(navigate).toHaveBeenLastCalledWith('/settings/duplicates/compare/book?group=g1')
  })

  it('wraps round to a skipped group after the last one', async () => {
    search = 'group=g3'
    render(<DuplicateCompareView />)
    await userEvent.click(await screen.findByRole('button', { name: /merge 1/ }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/settings/duplicates/compare/book?group=g1')
    )
  })

  it('says so when the queue is done', async () => {
    groups.mockResolvedValue({ groups: [group('g1', [member('a'), member('b')])] })
    search = 'group=g1'
    render(<DuplicateCompareView />)
    await userEvent.click(await screen.findByRole('button', { name: /merge 1/ }))
    expect(await screen.findByText('maintenance.dupes.review.finished')).toBeInTheDocument()
  })

  it('explains a group that is no longer in the list', async () => {
    search = 'group=gone'
    render(<DuplicateCompareView />)
    expect(await screen.findByText('maintenance.dupes.review.notInQueue')).toBeInTheDocument()
  })

  it('pages through a group too big to show at once, keeping the keeper in view', async () => {
    groups.mockResolvedValue({
      groups: [
        group(
          'big',
          ['k', 'm1', 'm2', 'm3', 'm4', 'm5'].map((id) =>
            member(id, id === 'k' ? { page_count: 99 } : {})
          )
        ),
      ],
    })
    search = 'group=big'
    render(<DuplicateCompareView />)
    await waitFor(() => expect(compare).toHaveBeenCalledWith('book', ['k', 'm1', 'm2', 'm3']))
    // Every other copy is merged, not just the ones on screen.
    await waitFor(() => expect(lastDryRun().merge_ids).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']))
    await userEvent.click(
      screen.getByRole('button', { name: 'maintenance.dupes.review.nextCopies' })
    )
    await waitFor(() => expect(compare).toHaveBeenCalledWith('book', ['k', 'm4', 'm5']))
  })
})
