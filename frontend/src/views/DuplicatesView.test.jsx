import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k === 'maintenance.dupes.pairsFound') return `${o.count} pairs found`
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
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

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

  it('starts a scan at the default accuracy', async () => {
    render(<DuplicatesView />)
    await waitFor(() => expect(scanStatus).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.scan/ }))
    expect(startScan).toHaveBeenCalledWith([], 'medium')
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

  it('lists a two-member group as a single pair', async () => {
    groups.mockResolvedValue({ groups: [group([member('b1'), member('b2')])] })
    render(<DuplicatesView />)
    await waitFor(() => expect(screen.getByText('1 pairs found')).toBeInTheDocument())
    expect(screen.getByText('identical files')).toBeInTheDocument()
  })

  it('breaks a five-member group into four parent-vs-child pairs', async () => {
    // The point of the pair split: five copies on one card is more than a
    // person can judge at once, and one verdict cannot separate the odd one out.
    groups.mockResolvedValue({
      groups: [group(['b1', 'b2', 'b3', 'b4', 'b5'].map(member))],
    })
    render(<DuplicatesView />)
    await waitFor(() => expect(screen.getByText('4 pairs found')).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /maintenance.dupes.compare/ })).toHaveLength(4)
  })

  it('opens the compare page for the pair that was clicked', async () => {
    groups.mockResolvedValue({ groups: [group([member('b1'), member('b2')])] })
    render(<DuplicatesView />)
    await waitFor(() => expect(screen.getByText('1 pairs found')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /maintenance.dupes.compare/ }))
    expect(navigate).toHaveBeenCalledWith('/settings/duplicates/compare/book?left=b1&right=b2')
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
