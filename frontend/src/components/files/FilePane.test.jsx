import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilePane, { DRAG_MIME, edgeScrollStep } from './FilePane'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

const entryDir = (name, extra = {}) => ({
  name,
  path: `books/System/${name}`,
  is_dir: true,
  child_count: 3,
  nsfw: false,
  container_kind: null,
  ...extra,
})

const entryFile = (name, extra = {}) => ({
  name,
  path: `books/System/${name}`,
  is_dir: false,
  size: 2048,
  record_id: 'r1',
  title: name,
  ...extra,
})

function makePane(overrides = {}) {
  const rows = overrides.rows || [
    { entry: entryDir('core'), depth: 0, isOpen: false },
    { entry: entryFile('bestiary.pdf'), depth: 0, isOpen: false },
  ]
  return {
    path: 'books/System',
    rows,
    entries: rows.filter((r) => r.entry).map((r) => r.entry),
    writable: true,
    parent: 'books',
    loading: false,
    error: null,
    selected: new Set(),
    expanded: new Set(),
    folders: {},
    navigate: vi.fn(),
    refresh: vi.fn(),
    toggle: vi.fn(),
    toggleExpand: vi.fn(),
    expand: vi.fn(),
    selectOnly: vi.fn(),
    clearSelection: vi.fn(),
    selectAll: vi.fn(),
    isWritable: () => true,
    ...overrides,
  }
}

function renderPane(pane, props = {}) {
  const all = {
    onDropPaths: vi.fn(),
    onOpenContext: vi.fn(),
    onRequestCreateFolder: vi.fn(),
    ...props,
  }
  render(<FilePane pane={pane} side="primary" {...all} />)
  return all
}

// jsdom has no DataTransfer, so drag events carry a minimal stand-in.
function dragData(payload) {
  return {
    types: [DRAG_MIME],
    getData: () => JSON.stringify(payload),
    setData: vi.fn(),
    dropEffect: '',
    effectAllowed: '',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
})

describe('FilePane', () => {
  it('creates a folder in the pane\u2019s own folder', async () => {
    // An empty folder has no row to right-click, so the pane needs its own
    // affordance for "make a folder here".
    const onNewFolder = vi.fn()
    renderPane(makePane(), { onNewFolder })

    await userEvent.click(screen.getByTestId('new-folder-primary'))

    expect(onNewFolder).toHaveBeenCalledWith('books/System')
  })

  it('hides the new-folder button on a read-only mount', () => {
    renderPane(makePane({ writable: false }), { onNewFolder: vi.fn() })
    expect(screen.queryByTestId('new-folder-primary')).not.toBeInTheDocument()
  })

  it('omits the new-folder button when no handler is supplied', () => {
    renderPane(makePane())
    expect(screen.queryByTestId('new-folder-primary')).not.toBeInTheDocument()
  })

  it('renders a breadcrumb for the current path', () => {
    renderPane(makePane())
    expect(screen.getByText('files.libraryRoot')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
  })

  it('expands a folder from its twisty', async () => {
    const pane = makePane()
    renderPane(pane)
    await userEvent.click(screen.getByTestId('twisty-core'))
    expect(pane.toggleExpand).toHaveBeenCalledWith('books/System/core')
  })

  it('does not select the row when the twisty is used', async () => {
    const pane = makePane()
    renderPane(pane)
    await userEvent.click(screen.getByTestId('twisty-core'))
    // Expanding is a different intent from selecting; the click must not do both.
    expect(pane.selectOnly).not.toHaveBeenCalled()
  })

  it('shows an open twisty and indents children of an expanded folder', () => {
    const pane = makePane({
      rows: [
        { entry: entryDir('core'), depth: 0, isOpen: true },
        { entry: entryFile('phb.pdf'), depth: 1, isOpen: false },
      ],
    })
    renderPane(pane)
    expect(screen.getByTestId('twisty-core')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('entry-phb.pdf').style.paddingLeft).toBe('26px')
  })

  it('files get no twisty, so only folders offer expansion', () => {
    renderPane(makePane())
    expect(screen.queryByTestId('twisty-bestiary.pdf')).not.toBeInTheDocument()
  })

  it('enters the folder on double click', async () => {
    const pane = makePane()
    renderPane(pane)
    await userEvent.dblClick(screen.getByTestId('entry-core'))
    // Double-click drills in, re-anchoring the pane; the twisty is what
    // expands in place. Both intents need a target of their own.
    expect(pane.navigate).toHaveBeenCalledWith('books/System/core')
    expect(pane.toggleExpand).not.toHaveBeenCalled()
  })

  it('does not navigate when a file is double clicked', async () => {
    const pane = makePane()
    renderPane(pane)
    await userEvent.dblClick(screen.getByTestId('entry-bestiary.pdf'))
    expect(pane.navigate).not.toHaveBeenCalled()
  })

  it('selects a single row on click and toggles with a modifier', async () => {
    const pane = makePane()
    renderPane(pane)
    await userEvent.click(screen.getByTestId('entry-bestiary.pdf'))
    expect(pane.selectOnly).toHaveBeenCalledWith('books/System/bestiary.pdf')

    fireEvent.click(screen.getByTestId('entry-core'), { ctrlKey: true })
    expect(pane.toggle).toHaveBeenCalledWith('books/System/core')
  })

  it('drops onto a folder and moves into that folder', () => {
    const { onDropPaths } = renderPane(makePane())
    fireEvent.drop(screen.getByTestId('entry-core'), {
      dataTransfer: dragData({ paths: ['books/x.pdf'], from: 'books' }),
    })
    expect(onDropPaths).toHaveBeenCalledWith(['books/x.pdf'], 'books/System/core')
  })

  it('drops onto the pane background and moves into the current folder', () => {
    const { onDropPaths } = renderPane(makePane())
    fireEvent.drop(screen.getByTestId('file-pane-primary'), {
      dataTransfer: dragData({ paths: ['books/y.pdf'], from: 'maps' }),
    })
    expect(onDropPaths).toHaveBeenCalledWith(['books/y.pdf'], 'books/System')
  })

  it('springs a collapsed folder open when a drag rests on it', () => {
    vi.useFakeTimers()
    const pane = makePane()
    renderPane(pane)

    fireEvent.dragOver(screen.getByTestId('entry-core'), { dataTransfer: dragData({}) })
    expect(pane.expand).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(700))
    // Hovering long enough opens the folder so a drag can continue deeper
    // without being dropped first.
    expect(pane.expand).toHaveBeenCalledWith('books/System/core')
    vi.useRealTimers()
  })

  it('does not spring open when the drag only passes over', () => {
    vi.useFakeTimers()
    const pane = makePane()
    renderPane(pane)
    const row = screen.getByTestId('entry-core')

    fireEvent.dragOver(row, { dataTransfer: dragData({}) })
    act(() => vi.advanceTimersByTime(200))
    fireEvent.dragLeave(row)
    act(() => vi.advanceTimersByTime(700))

    expect(pane.expand).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('clears drag affordances when a drag ends anywhere', () => {
    renderPane(makePane())
    const row = screen.getByTestId('entry-core')
    fireEvent.dragOver(row, { dataTransfer: dragData({}) })

    // A drop handled by the *other* pane never fires this pane's onDrop, so the
    // highlight has to be cleared by the global dragend.
    fireEvent(window, new Event('dragend'))
    expect(row.style.outline).toBe('none')
  })

  it('ignores a drop carrying no recognisable payload', () => {
    const { onDropPaths } = renderPane(makePane())
    fireEvent.drop(screen.getByTestId('file-pane-primary'), {
      dataTransfer: { types: [DRAG_MIME], getData: () => 'not json' },
    })
    expect(onDropPaths).not.toHaveBeenCalled()
  })

  it('drags the whole selection when the dragged row is part of it', () => {
    const pane = makePane({
      selected: new Set(['books/System/core', 'books/System/bestiary.pdf']),
    })
    renderPane(pane)
    const dt = dragData({})
    fireEvent.dragStart(screen.getByTestId('entry-core'), { dataTransfer: dt })
    expect(JSON.parse(dt.setData.mock.calls[0][1]).paths).toHaveLength(2)
  })

  it('drags only the row when it is not selected', () => {
    renderPane(makePane({ selected: new Set(['books/System/other']) }))
    const dt = dragData({})
    fireEvent.dragStart(screen.getByTestId('entry-core'), { dataTransfer: dt })
    expect(JSON.parse(dt.setData.mock.calls[0][1]).paths).toEqual(['books/System/core'])
  })

  it('marks a read-only folder', () => {
    renderPane(makePane({ writable: false }))
    expect(screen.getByText('files.readOnly')).toBeInTheDocument()
  })

  it('opens the context menu with the entry under the cursor', () => {
    const { onOpenContext } = renderPane(makePane())
    fireEvent.contextMenu(screen.getByTestId('entry-core'), { clientX: 10, clientY: 20 })
    expect(onOpenContext).toHaveBeenCalledWith(
      expect.objectContaining({ entry: expect.objectContaining({ name: 'core' }), side: 'primary' })
    )
  })

  it('shows badges for container kind, NSFW, and indexed state', () => {
    renderPane(
      makePane({
        rows: [
          {
            entry: entryDir('Publishers', { container_kind: 'publisher', nsfw: true }),
            depth: 0,
            isOpen: false,
          },
        ],
      })
    )
    expect(screen.getByText('files.kind.publisher')).toBeInTheDocument()
    expect(screen.getByText('files.nsfw')).toBeInTheDocument()
  })

  it('renders placeholder rows for loading, empty, and failed subfolders', () => {
    renderPane(
      makePane({
        rows: [
          { entry: entryDir('core'), depth: 0, isOpen: true },
          { placeholder: 'loading', path: 'books/System/core', depth: 1 },
          { placeholder: 'empty', path: 'books/System/other', depth: 1 },
          { placeholder: 'error', path: 'books/System/bad', depth: 1, text: 'Permission denied' },
        ],
      })
    )
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
    expect(screen.getByText('files.emptyFolder')).toBeInTheDocument()
    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })

  it('says when a folder is too large to list in full', () => {
    renderPane(
      makePane({
        rows: [
          { entry: entryFile('a.pdf'), depth: 0, isOpen: false },
          { placeholder: 'truncated', path: 'books/System', depth: 0, shown: 2000, total: 48213 },
        ],
      })
    )
    expect(screen.getByText(/files\.truncated/)).toBeInTheDocument()
  })

  it('only mounts a window of rows for a very large tree', () => {
    const rows = Array.from({ length: 20000 }, (_, i) => ({
      entry: entryFile(`file-${i}.pdf`),
      depth: 0,
      isOpen: false,
    }))
    renderPane(makePane({ rows }))
    // Virtualised: the DOM holds a screenful, not the whole library.
    const mounted = screen.getAllByTestId(/^entry-file-/)
    expect(mounted.length).toBeLessThan(80)
    expect(screen.getByTestId('entry-file-0.pdf')).toBeInTheDocument()
  })

  it('points at the right-click action when a folder is empty', () => {
    renderPane(makePane({ rows: [], entries: [] }))
    expect(screen.getByText('files.emptyFolder')).toBeInTheDocument()
    // Folder creation lives in the context menu now, so the empty state points
    // there rather than offering a second, subtly different button.
    expect(screen.getByText('files.emptyFolderHint')).toBeInTheDocument()
  })

  it('offers a close button only when the pane is closable', async () => {
    const onClose = vi.fn()
    renderPane(makePane(), { onClose })
    await userEvent.click(screen.getByTestId('close-pane-primary'))
    expect(onClose).toHaveBeenCalled()
  })

  it('has no close button when it is the only pane', () => {
    renderPane(makePane())
    expect(screen.queryByTestId('close-pane-primary')).not.toBeInTheDocument()
  })
})

describe('edgeScrollStep', () => {
  const box = { top: 100, bottom: 500 }

  it('scrolls up near the top edge', () => {
    // Negative step: a drag held at the top pulls earlier rows into view.
    expect(edgeScrollStep(box, 110)).toBeLessThan(0)
  })

  it('scrolls down near the bottom edge', () => {
    expect(edgeScrollStep(box, 490)).toBeGreaterThan(0)
  })

  it('does nothing in the middle', () => {
    // Otherwise the list would creep while dragging across it.
    expect(edgeScrollStep(box, 300)).toBe(0)
  })

  it('treats the zone boundary as outside', () => {
    expect(edgeScrollStep(box, 100 + 48)).toBe(0)
    expect(edgeScrollStep(box, 500 - 48)).toBe(0)
  })
})
