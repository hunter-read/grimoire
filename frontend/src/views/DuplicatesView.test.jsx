import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k === 'maintenance.dupes.groupsFound') return `${o.count} groups found`
      if (k === 'maintenance.dupes.mergeExact.button') return `merge exact ${o.count}`
      if (k === 'maintenance.dupes.mergeExact.done') return `merged ${o.count}, skipped ${o.failed}`
      return k
    },
  }),
}))

const scanStatus = vi.fn()
const startScan = vi.fn()
const cancelScan = vi.fn()
const groups = vi.fn()
const dismissalsFn = vi.fn()
const undismiss = vi.fn()

const navigate = vi.fn()
// The list's filters live in the URL. Set before render to start filtered.
let searchParams = new URLSearchParams()
const setSearchParams = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams, setSearchParams],
}))

// The dialogs have their own tests; here only the wiring to them matters.
vi.mock('../components/duplicates/MergeDialog', () => ({
  default: ({ ids, keepId, onDone }) => (
    <div>
      merge dialog {ids.join(',')} keeping {keepId}
      <button onClick={() => onDone({ action: 'merged', keepId, removedIds: [] })}>
        finish merge
      </button>
    </div>
  ),
}))
vi.mock('../components/duplicates/MergeExactDialog', () => ({
  default: ({ groups: exact, onDone }) => (
    <div>
      exact dialog {exact.map((g) => g.id).join(',')}
      <button onClick={() => onDone({ merged: exact.length, failed: 0 })}>finish exact</button>
    </div>
  ),
}))

// Admin by default: the page is admin-only, and every behaviour test below is
// about what an admin sees. The non-admin case is asserted explicitly.
let role = 'admin'
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }))

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  duplicates: {
    scanStatus: (...a) => scanStatus(...a),
    startScan: (...a) => startScan(...a),
    cancelScan: (...a) => cancelScan(...a),
    groups: (...a) => groups(...a),
    dismissals: (...a) => dismissalsFn(...a),
    undismiss: (...a) => undismiss(...a),
    link: vi.fn(),
    dismiss: vi.fn(),
    deleteItem: vi.fn(),
  },
}))

import DuplicatesView from './DuplicatesView'

const IDLE = { running: false, finished_at: null, total: 0, scanned: 0 }

describe('DuplicatesView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    role = 'admin'
    searchParams = new URLSearchParams()
    scanStatus.mockResolvedValue(IDLE)
    groups.mockResolvedValue({ groups: [] })
    startScan.mockResolvedValue({ status: 'scan_started' })
    cancelScan.mockResolvedValue({ status: 'stop_requested' })
    dismissalsFn.mockResolvedValue({ dismissals: [] })
    undismiss.mockResolvedValue({ status: 'removed' })
  })

  it('says nothing has been scanned yet', async () => {
    render(<DuplicatesView />)
    await waitFor(() =>
      expect(screen.getByText('maintenance.dupes.notScanned')).toBeInTheDocument()
    )
  })

  it('reports no duplicates after a completed scan finds none', async () => {
    scanStatus.mockResolvedValue({ ...IDLE, finished_at: '2026-01-01T00:00:00Z' })
    render(<DuplicatesView />)
    await waitFor(() => expect(screen.getByText('maintenance.dupes.noResults')).toBeInTheDocument())
  })

  it('starts a scan at the default accuracy, across every collection', async () => {
    render(<DuplicatesView />)
    await waitFor(() => expect(scanStatus).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.scan/ }))
    // 'high' rather than 'medium': the default catches a renamed copy without
    // returning matches that all need judging. Empty types means all four.
    expect(startScan).toHaveBeenCalledWith([], 'high')
  })

  it('limits the scan to the ticked collections', async () => {
    render(<DuplicatesView />)
    await waitFor(() => expect(scanStatus).toHaveBeenCalled())
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'maintenance.dupes.collection.map' })
    )
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'maintenance.dupes.collection.token' })
    )
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.scan/ }))
    expect(startScan).toHaveBeenCalledWith(['map', 'token'], 'high')
  })

  it('unticking a collection puts it back in the scan', async () => {
    render(<DuplicatesView />)
    await waitFor(() => expect(scanStatus).toHaveBeenCalled())
    const books = screen.getByRole('checkbox', { name: 'maintenance.dupes.collection.book' })
    await userEvent.click(books)
    await userEvent.click(books)
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.scan/ }))
    // Back to empty, which the API reads as "every collection" - not a scan of
    // nothing, which would silently find no duplicates at all.
    expect(startScan).toHaveBeenCalledWith([], 'high')
  })

  it('locks the collection checkboxes while a scan runs', async () => {
    scanStatus.mockResolvedValue({ running: true, phase: 'hashing', scanned: 1, total: 2 })
    render(<DuplicatesView />)
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'maintenance.dupes.collection.book' })
      ).toBeDisabled()
    )
  })

  it('scans at the chosen accuracy', async () => {
    render(<DuplicatesView />)
    await waitFor(() => expect(scanStatus).toHaveBeenCalled())
    await userEvent.selectOptions(screen.getByRole('combobox'), 'exact')
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.scan/ }))
    expect(startScan).toHaveBeenCalledWith([], 'exact')
  })

  it('locks the accuracy control while a scan runs', async () => {
    scanStatus.mockResolvedValue({ running: true, phase: 'metadata', scanned: 1, total: 2 })
    render(<DuplicatesView />)
    await waitFor(() => expect(screen.getByRole('combobox')).toBeDisabled())
  })

  it('surfaces a failure to start', async () => {
    startScan.mockRejectedValue(new Error('boom'))
    render(<DuplicatesView />)
    await waitFor(() => expect(scanStatus).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.scan/ }))
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })

  it('shows progress and a stop button while running', async () => {
    scanStatus.mockResolvedValue({
      running: true,
      phase: 'metadata',
      resource_type: 'book',
      scanned: 5,
      total: 10,
    })
    render(<DuplicatesView />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /maintenance.dupes.cancel/ })).toBeInTheDocument()
    )
    expect(screen.getByText(/50%/)).toBeInTheDocument()
  })

  const group = (members, extra = {}) => ({
    id: 'g1',
    resource_type: 'book',
    confidence: 1,
    reasons: ['hash'],
    reason_text: 'identical files',
    suggested_parent_id: 'b1',
    members,
    ...extra,
  })

  const member = (id) => ({
    id,
    filename: `${id}.pdf`,
    relative_path: `books/${id}.pdf`,
    file_size: 10,
  })

  it('lists a group as one row with every copy, marking the keeper', async () => {
    groups.mockResolvedValue({
      groups: [group([member('b1'), { ...member('b2'), page_count: 300 }, member('b3')])],
    })
    render(<DuplicatesView />)
    await waitFor(() => expect(screen.getByText('1 groups found')).toBeInTheDocument())
    // One row for the whole group: a merge settles every copy at once.
    expect(screen.getAllByRole('button', { name: /maintenance.dupes.review.open/ })).toHaveLength(1)
    for (const id of ['b1', 'b2', 'b3']) expect(screen.getByText(`${id}.pdf`)).toBeInTheDocument()
    // The most pages wins, whatever the scan suggested.
    const kept = screen.getByText('maintenance.dupes.review.keeps')
    expect(kept.closest('li')).toHaveTextContent('b2.pdf')
  })

  it('opens the review queue at the group that was clicked', async () => {
    groups.mockResolvedValue({ groups: [group([member('b1'), member('b2')])] })
    render(<DuplicatesView />)
    await userEvent.click(
      await screen.findByRole('button', { name: /maintenance.dupes.review.open/ })
    )
    expect(navigate).toHaveBeenCalledWith('/settings/duplicates/compare/book?group=g1')
  })

  it('starts the review at the first listed group, carrying the filters', async () => {
    searchParams = new URLSearchParams('type=book&match=exact')
    groups.mockResolvedValue({
      groups: [
        group([
          { ...member('b1'), content_hash: 'h' },
          { ...member('b2'), content_hash: 'h' },
        ]),
      ],
    })
    render(<DuplicatesView />)
    await userEvent.click(
      await screen.findByRole('button', { name: /maintenance.dupes.review.start/ })
    )
    expect(navigate).toHaveBeenCalledWith(
      '/settings/duplicates/compare/book?group=g1&type=book&match=exact'
    )
  })

  it('shows only the groups matching the URL filters', async () => {
    searchParams = new URLSearchParams('match=exact')
    groups.mockResolvedValue({
      groups: [
        group([
          { ...member('b1'), content_hash: 'h' },
          { ...member('b2'), content_hash: 'h' },
        ]),
        group([member('b3'), member('b4')], { id: 'g2', reasons: ['metadata'] }),
      ],
    })
    render(<DuplicatesView />)
    await waitFor(() => expect(screen.getByText('1 groups found')).toBeInTheDocument())
    expect(screen.queryByText('b3.pdf')).not.toBeInTheDocument()
  })

  it('says so when no group matches the filters', async () => {
    searchParams = new URLSearchParams('type=map')
    groups.mockResolvedValue({ groups: [group([member('b1'), member('b2')])] })
    render(<DuplicatesView />)
    await waitFor(() =>
      expect(screen.getByText('maintenance.dupes.noneMatchFilters')).toBeInTheDocument()
    )
  })

  it('writes a changed filter into the URL', async () => {
    searchParams = new URLSearchParams('type=book')
    groups.mockResolvedValue({ groups: [group([member('b1'), member('b2')])] })
    render(<DuplicatesView />)
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'maintenance.dupes.filterMatch' }),
      'text'
    )
    const update = setSearchParams.mock.calls.at(-1)[0]
    expect(update(searchParams).toString()).toBe('type=book&match=text')
    // Back to "all" drops the key rather than leaving `match=`.
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'maintenance.dupes.filterType' }),
      ''
    )
    expect(setSearchParams.mock.calls.at(-1)[0](searchParams).toString()).toBe('')
  })

  it('quick-merges a row into its keeper and drops it from the list', async () => {
    groups.mockResolvedValue({
      groups: [group([member('b1'), { ...member('b2'), file_size: 99 }])],
    })
    render(<DuplicatesView />)
    await userEvent.click(await screen.findByRole('button', { name: /merge.action/ }))
    expect(screen.getByText('merge dialog b1,b2 keeping b2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'finish merge' }))
    await waitFor(() => expect(screen.queryByText('b1.pdf')).not.toBeInTheDocument())
  })

  it('merges every exact group behind one dialog, then reloads', async () => {
    const exact = (id, a, b) =>
      group(
        [
          { ...member(a), content_hash: id },
          { ...member(b), content_hash: id },
        ],
        { id }
      )
    groups.mockResolvedValue({
      groups: [
        exact('e1', 'b1', 'b2'),
        exact('e2', 'b3', 'b4'),
        // Linked by hash for one pair only: not every file is identical.
        group([{ ...member('b5'), content_hash: 'x' }, member('b6')], { id: 'g3' }),
      ],
    })
    render(<DuplicatesView />)
    await userEvent.click(await screen.findByRole('button', { name: 'merge exact 2' }))
    expect(screen.getByText('exact dialog e1,e2')).toBeInTheDocument()

    groups.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'finish exact' }))
    expect(await screen.findByText('merged 2, skipped 0')).toBeInTheDocument()
    expect(groups).toHaveBeenCalled()
  })

  it('refuses non-admins', async () => {
    role = 'player'
    render(<DuplicatesView />)
    expect(screen.getByText('maintenance.dupes.adminOnly')).toBeInTheDocument()
    // The guard returns before any request goes out.
    expect(groups).not.toHaveBeenCalled()
  })

  it('goes back to the maintenance tab', async () => {
    render(<DuplicatesView />)
    await userEvent.click(screen.getByRole('button', { name: /files.backToSettings/ }))
    expect(navigate).toHaveBeenCalledWith('/settings/maintenance')
  })
})

describe('DuplicatesView error reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    role = 'admin'
    searchParams = new URLSearchParams()
    scanStatus.mockResolvedValue(IDLE)
    groups.mockResolvedValue({ groups: [] })
    startScan.mockResolvedValue({ status: 'scan_started' })
    cancelScan.mockResolvedValue({ status: 'stop_requested' })
  })

  it('shows why the group list failed instead of an empty result', async () => {
    // A failed query used to render as "no duplicates found", which is what
    // made the missing duplicate_groups.edges column invisible for so long.
    groups.mockRejectedValue(new Error('no such column: duplicate_groups.edges'))

    render(<DuplicatesView />)

    await waitFor(() =>
      expect(screen.getByText(/no such column: duplicate_groups.edges/)).toBeInTheDocument()
    )
  })

  it('surfaces a scan that failed mid-run', async () => {
    // The job catches its own exceptions and returns a settled status, so the
    // error field is the only evidence the run died rather than found nothing.
    scanStatus.mockResolvedValue({ ...IDLE, error: 'table has no column named edges' })

    render(<DuplicatesView />)

    await waitFor(() =>
      expect(screen.getByText(/table has no column named edges/)).toBeInTheDocument()
    )
  })

  it('clears a stale error once the groups load cleanly', async () => {
    groups.mockRejectedValueOnce(new Error('boom'))
    render(<DuplicatesView />)
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument())

    groups.mockResolvedValue({ groups: [] })
    await userEvent.click(screen.getByText('maintenance.dupes.scan'))

    await waitFor(() => expect(screen.queryByText(/boom/)).not.toBeInTheDocument())
  })
})

describe('DuplicatesView dismissed pairs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    role = 'admin'
    searchParams = new URLSearchParams()
    scanStatus.mockResolvedValue(IDLE)
    groups.mockResolvedValue({ groups: [] })
    dismissalsFn.mockResolvedValue({ dismissals: [] })
    undismiss.mockResolvedValue({ status: 'removed' })
  })

  const DISMISSAL = {
    id: 'd1',
    resource_type: 'book',
    member_ids: ['a', 'b'],
    member_names: ['core.pdf', 'core (1).pdf'],
    note: '',
    created_at: '2026-01-01T00:00:00',
  }

  it('does not fetch dismissals until the panel is opened', async () => {
    render(<DuplicatesView />)
    await waitFor(() => expect(groups).toHaveBeenCalled())
    expect(dismissalsFn).not.toHaveBeenCalled()
  })

  it('lists what has been dismissed once opened', async () => {
    dismissalsFn.mockResolvedValue({ dismissals: [DISMISSAL] })
    render(<DuplicatesView />)

    await userEvent.click(screen.getByText('maintenance.dupes.showDismissed'))

    await waitFor(() => expect(screen.getByText('core.pdf')).toBeInTheDocument())
    expect(screen.getByText('core (1).pdf')).toBeInTheDocument()
  })

  it('says so when nothing has been dismissed', async () => {
    render(<DuplicatesView />)
    await userEvent.click(screen.getByText('maintenance.dupes.showDismissed'))
    await waitFor(() =>
      expect(screen.getByText('maintenance.dupes.noDismissals')).toBeInTheDocument()
    )
  })

  it('hides the panel again when toggled off', async () => {
    dismissalsFn.mockResolvedValue({ dismissals: [DISMISSAL] })
    render(<DuplicatesView />)

    await userEvent.click(screen.getByText('maintenance.dupes.showDismissed'))
    await waitFor(() => expect(screen.getByText('core.pdf')).toBeInTheDocument())

    await userEvent.click(screen.getByText('maintenance.dupes.hideDismissed'))
    expect(screen.queryByText('core.pdf')).not.toBeInTheDocument()
  })

  it('drops a restored dismissal from the list', async () => {
    dismissalsFn.mockResolvedValue({ dismissals: [DISMISSAL] })
    render(<DuplicatesView />)

    await userEvent.click(screen.getByText('maintenance.dupes.showDismissed'))
    await waitFor(() => expect(screen.getByText('core.pdf')).toBeInTheDocument())

    await userEvent.click(screen.getByText('maintenance.dupes.undismiss'))

    await waitFor(() => expect(undismiss).toHaveBeenCalledWith('d1'))
    await waitFor(() => expect(screen.queryByText('core.pdf')).not.toBeInTheDocument())
  })

  it('keeps the row and reports the failure when restore fails', async () => {
    dismissalsFn.mockResolvedValue({ dismissals: [DISMISSAL] })
    undismiss.mockRejectedValue(new Error('nope'))
    render(<DuplicatesView />)

    await userEvent.click(screen.getByText('maintenance.dupes.showDismissed'))
    await waitFor(() => expect(screen.getByText('core.pdf')).toBeInTheDocument())

    await userEvent.click(screen.getByText('maintenance.dupes.undismiss'))

    await waitFor(() => expect(screen.getByText(/nope/)).toBeInTheDocument())
    expect(screen.getByText('core.pdf')).toBeInTheDocument()
  })

  it('surfaces a failed dismissals load instead of showing an empty panel', async () => {
    dismissalsFn.mockRejectedValue(new Error('kaboom'))
    render(<DuplicatesView />)

    await userEvent.click(screen.getByText('maintenance.dupes.showDismissed'))

    await waitFor(() => expect(screen.getByText(/kaboom/)).toBeInTheDocument())
  })
})

describe('DuplicatesView stopping a scan', () => {
  // A scan whose process died still reports running, so Stop is the only way
  // out of the page. It used to discard its result entirely, which made a
  // failed request and a successfully-cleared scan both look like a dead
  // button (issue #304).
  const RUNNING = {
    running: true,
    phase: 'metadata',
    resource_type: 'book',
    total: 0,
    scanned: 0,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    role = 'admin'
    scanStatus.mockResolvedValue(RUNNING)
    groups.mockResolvedValue({ groups: [] })
    startScan.mockResolvedValue({ status: 'scan_started' })
    cancelScan.mockResolvedValue({ status: 'stop_requested' })
    dismissalsFn.mockResolvedValue({ dismissals: [] })
    undismiss.mockResolvedValue({ status: 'removed' })
  })

  it('reports a Stop request that failed rather than looking inert', async () => {
    cancelScan.mockRejectedValue(new Error('server said no'))
    render(<DuplicatesView />)

    await userEvent.click(await screen.findByRole('button', { name: /dupes.cancel/ }))

    await waitFor(() => expect(screen.getByText(/server said no/)).toBeInTheDocument())
  })

  it('clears the running state at once when a stuck scan is swept away', async () => {
    // The backend found no live scan behind the status and cleared it. Waiting
    // for the next poll would leave the spinner up for another second on a page
    // the user already believes is broken.
    cancelScan.mockResolvedValue({ status: 'cleared_stale' })
    render(<DuplicatesView />)

    const stop = await screen.findByRole('button', { name: /dupes.cancel/ })
    await userEvent.click(stop)

    // Cleared from the cancel response alone. The status poll is still
    // insisting the scan runs (scanStatus is never switched to IDLE here), so
    // only the response can have taken the spinner down - the poll would not
    // notice until the backend and this worker agree, which is exactly the
    // wait that made the button feel dead.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /dupes.cancel/ })).not.toBeInTheDocument()
    )
  })

  it('keeps showing progress while a live scan winds itself down', async () => {
    // stop_requested means the scan is still running and discarding its partial
    // results. Hiding the progress then would claim it had already finished.
    cancelScan.mockResolvedValue({ status: 'stop_requested' })
    render(<DuplicatesView />)

    await userEvent.click(await screen.findByRole('button', { name: /dupes.cancel/ }))

    await waitFor(() => expect(cancelScan).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /dupes.cancel/ })).toBeInTheDocument()
  })
})
