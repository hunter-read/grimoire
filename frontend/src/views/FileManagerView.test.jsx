import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FileManagerView from './FileManagerView'
import { files as filesApi } from '../api'
import { useAuth } from '../context/AuthContext'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../api', () => ({
  // The scan-status poller behind the rescan controls uses the default export,
  // and the preview modal builds media URLs — both reachable from this view.
  default: {
    get: vi.fn(() => Promise.resolve({ running: false })),
    post: vi.fn(() => Promise.resolve({})),
  },
  mediaUrl: (path) => `/api${path}`,
  bookPageUrl: (id, page) => `/api/books/${id}/page/${page}`,
  files: {
    browse: vi.fn(),
    move: vi.fn(),
    rename: vi.fn(),
    createFolder: vi.fn(),
    setMarkers: vi.fn(),
    deleteFolder: vi.fn(),
    scaffold: vi.fn(),
    record: vi.fn(),
  },
}))
const uploadQueue = {
  items: [],
  counts: { queued: 0, uploading: 0, done: 0, error: 0, cancelled: 0 },
  inFlight: 0,
  enqueue: vi.fn(),
  retry: vi.fn(),
  retryFailed: vi.fn(),
  cancel: vi.fn(),
  cancelAll: vi.fn(),
  clearCompleted: vi.fn(),
}
vi.mock('../hooks/useUploadQueue', () => ({ default: () => uploadQueue }))
vi.mock('../components/BulkEditModal', () => ({
  default: ({ items, onSaved }) => (
    <div data-testid="metadata-modal">
      <span data-testid="metadata-title">{items[0]?.title}</span>
      <button onClick={() => onSaved({})}>save-metadata</button>
    </div>
  ),
}))

// Entry paths are built from the folder being listed, so each pane's rows carry
// that pane's own paths — the difference that makes a cross-pane move assertion
// meaningful.
const folder = (name, parent = 'books', extra = {}) => ({
  name,
  path: `${parent}/${name}`,
  is_dir: true,
  child_count: 2,
  nsfw: false,
  container_kind: null,
  ...extra,
})

const file = (name, parent = 'books', extra = {}) => ({
  name,
  path: `${parent}/${name}`,
  is_dir: false,
  size: 1024,
  record_id: 'rec-1',
  title: name,
  collection: 'books',
  is_missing: false,
  ...extra,
})

function browseResult(entries, path = 'books', extra = {}) {
  return { path, parent: '', writable: true, entries, singletons_taken: {}, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  uploadQueue.items = []
  useAuth.mockReturnValue({ user: { role: 'admin' } })
  // Each pane must echo back its own path: the destination of a cross-pane move
  // is the *other* pane's current folder, so a shared response would make the
  // move look like it targeted the source.
  filesApi.browse.mockImplementation((path) =>
    Promise.resolve(browseResult([folder('core', path), file('bestiary.pdf', path)], path))
  )
})

describe('FileManagerView', () => {
  it('blocks non-admins', async () => {
    useAuth.mockReturnValue({ user: { role: 'gm' } })
    render(<FileManagerView />)
    // The panes are not rendered, so no file listing or action reaches a
    // non-admin. (The backend is the real gate — every /files route is
    // admin-only — so this is defence in depth, not the only check.)
    expect(screen.getByText('files.adminOnly')).toBeInTheDocument()
    expect(screen.queryByTestId('file-pane-primary')).not.toBeInTheDocument()
  })

  it('opens with a single pane', async () => {
    render(<FileManagerView />)
    await screen.findByTestId('file-pane-primary')
    // Two panes are a tool for a specific job, not the default way to look at a
    // library — the split only appears once a folder is pinned.
    expect(screen.queryByTestId('file-pane-secondary')).not.toBeInTheDocument()
    expect(screen.getByTestId('split-none')).toBeInTheDocument()
  })

  it('pins a folder into a second pane on the chosen edge', async () => {
    render(<FileManagerView />)
    await pinRight()

    expect(await screen.findByTestId('file-pane-secondary')).toBeInTheDocument()
    expect(screen.getByTestId('split-right')).toBeInTheDocument()
    await waitFor(() => expect(filesApi.browse).toHaveBeenCalledWith('books/core'))
  })

  it.each(['right', 'left', 'top', 'bottom'])('pins to the %s edge', async (edge) => {
    render(<FileManagerView />)
    await openMenuOn('core')
    await openSubmenu('pin-submenu')
    await userEvent.click(await screen.findByTestId(`pin-${edge}`))
    expect(await screen.findByTestId(`split-${edge}`)).toBeInTheDocument()
  })

  it('closes the second pane and returns to one', async () => {
    render(<FileManagerView />)
    await pinRight()

    await userEvent.click(screen.getByTestId('close-pane-secondary'))

    expect(screen.queryByTestId('file-pane-secondary')).not.toBeInTheDocument()
    expect(screen.getByTestId('split-none')).toBeInTheDocument()
  })

  it('offers no pin action once a second pane is open', async () => {
    render(<FileManagerView />)
    await pinRight()

    await openMenuOn('core')
    // There is only ever one second pane; offering to pin again would be a lie.
    expect(screen.queryByTestId('pin-submenu')).not.toBeInTheDocument()
  })

  it('offers no close button when there is only one pane', async () => {
    render(<FileManagerView />)
    await screen.findByTestId('file-pane-primary')
    // Nothing to close down to — the × only appears once a split exists.
    expect(screen.queryByTestId('close-pane-primary')).not.toBeInTheDocument()
  })

  it('marks indexed files so the stakes of a move are visible', async () => {
    render(<FileManagerView />)
    const pane = await screen.findByTestId('file-pane-primary')
    expect(within(pane).getAllByText('files.indexed').length).toBeGreaterThan(0)
  })

  it('moves the selection across panes and reports the count', async () => {
    filesApi.move.mockResolvedValue({ moved: [{}], skipped: [], count: 1 })
    render(<FileManagerView />)
    await pinRight()

    const pane = screen.getByTestId('file-pane-primary')
    await userEvent.click(within(pane).getByTestId('entry-bestiary.pdf'))
    await userEvent.click(screen.getByTitle('files.moveAcrossHint'))

    // The conflict policy is applied by the api wrapper's default, so the view
    // passes only the paths and the destination pane's folder.
    await waitFor(() =>
      expect(filesApi.move).toHaveBeenCalledWith(['books/bestiary.pdf'], 'books/core')
    )
    expect(await screen.findByRole('status')).toHaveTextContent('files.movedCount')
  })

  it('surfaces the reason when every item is refused', async () => {
    filesApi.move.mockResolvedValue({
      moved: [],
      skipped: [
        { path: 'books/bestiary.pdf', reason: 'A file named that exists', code: 'conflict' },
      ],
      count: 0,
    })
    render(<FileManagerView />)
    await pinRight()

    const pane = screen.getByTestId('file-pane-primary')
    await userEvent.click(within(pane).getByTestId('entry-bestiary.pdf'))
    await userEvent.click(screen.getByTitle('files.moveAcrossHint'))

    expect(await screen.findByRole('status')).toHaveTextContent('A file named that exists')
  })

  it('reports a failed move instead of failing silently', async () => {
    filesApi.move.mockRejectedValue(new Error('Library is read-only'))
    render(<FileManagerView />)
    await pinRight()

    const pane = screen.getByTestId('file-pane-primary')
    await userEvent.click(within(pane).getByTestId('entry-bestiary.pdf'))
    await userEvent.click(screen.getByTitle('files.moveAcrossHint'))

    expect(await screen.findByRole('status')).toHaveTextContent('Library is read-only')
  })

  it('hides the move fallback until something is selected', async () => {
    render(<FileManagerView />)
    await screen.findByTestId('file-pane-primary')
    // Dragging is the primary gesture; the button is a fallback that would be
    // dead UI with nothing selected — and meaningless with only one pane.
    expect(screen.queryByTitle('files.moveAcrossHint')).not.toBeInTheDocument()
    expect(filesApi.move).not.toHaveBeenCalled()
  })

  it('creates a folder with the chosen container kind', async () => {
    filesApi.createFolder.mockResolvedValue({ path: 'books/New', container_kind: 'parent' })
    render(<FileManagerView />)
    // Creating a folder is a right-click action on the folder it goes inside.
    await openMenuOn('core')
    await userEvent.click(screen.getByText('files.newFolderInside'))
    await userEvent.type(screen.getByLabelText('files.folderName'), 'Publishers')
    await userEvent.selectOptions(screen.getByLabelText('files.containerKind'), 'parent')
    await userEvent.click(screen.getByText('files.create'))

    await waitFor(() =>
      expect(filesApi.createFolder).toHaveBeenCalledWith('books/core', 'Publishers', {
        containerKind: 'parent',
        nsfw: false,
      })
    )
  })

  // The context menu is where rename, marker changes, and folder deletion live.
  // Opening it requires a right-click on a row.
  async function openMenuOn(name, pane = 'primary') {
    const target = await screen.findByTestId(`file-pane-${pane}`)
    fireEvent.contextMenu(within(target).getByTestId(`entry-${name}`), {
      clientX: 10,
      clientY: 10,
    })
  }

  // Multi-choice actions (pin edges, container kinds) live behind a submenu so
  // the top level stays scannable; open it before clicking a leaf.
  async function openSubmenu(testId) {
    await userEvent.click(await screen.findByTestId(testId))
  }

  async function pinRight() {
    await openMenuOn('core')
    await openSubmenu('pin-submenu')
    await userEvent.click(await screen.findByTestId('pin-right'))
    return screen.findByTestId('file-pane-secondary')
  }

  it('creates a folder in the pane\u2019s own folder from the breadcrumb button', async () => {
    // The right-click route needs a folder to click on, which an empty folder
    // does not have — so the pane carries its own "new folder here" button.
    filesApi.createFolder.mockResolvedValue({ path: 'books/New' })
    render(<FileManagerView />)

    await userEvent.click(await screen.findByTestId('new-folder-primary'))
    const input = await screen.findByLabelText('files.folderName')
    await userEvent.type(input, 'Homebrew')
    await userEvent.click(screen.getByRole('button', { name: 'files.create' }))

    await waitFor(() =>
      expect(filesApi.createFolder).toHaveBeenCalledWith('books', 'Homebrew', expect.anything())
    )
  })

  it('hides the new-folder button on a read-only mount', async () => {
    filesApi.browse.mockImplementation((path) =>
      Promise.resolve(browseResult([folder('core', path)], path, { writable: false }))
    )
    render(<FileManagerView />)
    await screen.findByTestId('file-pane-primary')

    // The API would refuse the write, so the affordance is not offered.
    expect(screen.queryByTestId('new-folder-primary')).not.toBeInTheDocument()
  })

  it('reloads the folder a new folder landed in, even when it was collapsed', async () => {
    // The bug: refresh only re-read folders already on screen, so a folder
    // created inside a collapsed parent never appeared until a manual refresh.
    filesApi.createFolder.mockResolvedValue({ path: 'books/core/New' })
    render(<FileManagerView />)
    await openMenuOn('core')
    await userEvent.click(screen.getByText('files.newFolderInside'))
    const input = await screen.findByLabelText('files.folderName')
    await userEvent.type(input, 'Maps')
    filesApi.browse.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'files.create' }))

    await waitFor(() => expect(filesApi.browse).toHaveBeenCalledWith('books/core'))
  })

  it('offers a scoped rescan from the context menu', async () => {
    render(<FileManagerView />)
    await openMenuOn('core')

    await userEvent.click(await screen.findByTestId('rescan-entry'))
    // The mode modal owns the actual request; opening it with the row's path is
    // this view's job.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('previews an indexed file but not a folder', async () => {
    render(<FileManagerView />)

    await openMenuOn('core')
    expect(screen.queryByTestId('preview-entry')).not.toBeInTheDocument()

    await openMenuOn('bestiary.pdf')
    expect(await screen.findByTestId('preview-entry')).toBeInTheDocument()
  })

  it('opens the preview modal with the loaded record', async () => {
    filesApi.record.mockResolvedValue({ id: 'rec-1', title: 'Bestiary', page_count: 12 })
    render(<FileManagerView />)
    await openMenuOn('bestiary.pdf')

    await userEvent.click(await screen.findByTestId('preview-entry'))

    expect(await screen.findByTestId('preview-page')).toBeInTheDocument()
    expect(filesApi.record).toHaveBeenCalledWith('book', 'rec-1')
  })

  it('renames an item from the context menu', async () => {
    filesApi.rename.mockResolvedValue({ from: 'books/core', to: 'books/rulebooks', records: 3 })
    render(<FileManagerView />)
    await openMenuOn('core')

    await userEvent.click(screen.getByText('files.rename'))
    const input = await screen.findByLabelText('files.newName')
    await userEvent.clear(input)
    await userEvent.type(input, 'rulebooks')
    await userEvent.click(screen.getByRole('button', { name: 'files.rename' }))

    await waitFor(() => expect(filesApi.rename).toHaveBeenCalledWith('books/core', 'rulebooks'))
    expect(await screen.findByRole('status')).toHaveTextContent('files.renamed')
  })

  it('toggles the NSFW marker on a folder', async () => {
    filesApi.setMarkers.mockResolvedValue({ path: 'books/core', nsfw: true, container_kind: '' })
    render(<FileManagerView />)
    await openMenuOn('core')

    await userEvent.click(screen.getByText('files.markNsfw'))

    await waitFor(() =>
      expect(filesApi.setMarkers).toHaveBeenCalledWith('books/core', { nsfw: true })
    )
    expect(await screen.findByRole('status')).toHaveTextContent('files.markersUpdated')
  })

  it('sets a container kind from the context menu', async () => {
    filesApi.setMarkers.mockResolvedValue({ path: 'books/core', container_kind: 'parent' })
    render(<FileManagerView />)
    await openMenuOn('core')

    await openSubmenu('container-submenu')
    await userEvent.click(await screen.findByTestId('kind-parent'))

    await waitFor(() =>
      expect(filesApi.setMarkers).toHaveBeenCalledWith('books/core', { containerKind: 'parent' })
    )
  })

  it('deletes an empty folder', async () => {
    filesApi.deleteFolder.mockResolvedValue({ path: 'books/core' })
    render(<FileManagerView />)
    await openMenuOn('core')

    await userEvent.click(screen.getByText('files.deleteEmptyFolder'))

    await waitFor(() => expect(filesApi.deleteFolder).toHaveBeenCalledWith('books/core'))
    expect(await screen.findByRole('status')).toHaveTextContent('files.folderDeleted')
  })

  it('reports why a folder could not be deleted', async () => {
    filesApi.deleteFolder.mockRejectedValue(new Error('Folder is not empty'))
    render(<FileManagerView />)
    await openMenuOn('core')

    await userEvent.click(screen.getByText('files.deleteEmptyFolder'))

    expect(await screen.findByRole('status')).toHaveTextContent('Folder is not empty')
  })

  it('highlights context-menu rows on hover', async () => {
    render(<FileManagerView />)
    await openMenuOn('core')

    const item = screen.getByText('files.rename')
    fireEvent.mouseEnter(item)
    expect(item.style.background).toBe('var(--bg-card-hover)')
    fireEvent.mouseLeave(item)
    expect(item.style.background).toBe('transparent')
  })

  it('offers no folder-only actions for a file', async () => {
    render(<FileManagerView />)
    await openMenuOn('bestiary.pdf')

    // Rename applies to files too; marker and delete actions must not.
    expect(screen.getByText('files.rename')).toBeInTheDocument()
    expect(screen.queryByText('files.deleteEmptyFolder')).not.toBeInTheDocument()
    expect(screen.queryByText('files.markNsfw')).not.toBeInTheDocument()
  })

  it('moves items dropped onto a pane', async () => {
    filesApi.move.mockResolvedValue({ moved: [{}], skipped: [], count: 1 })
    render(<FileManagerView />)
    const pane = await screen.findByTestId('file-pane-primary')

    // Dropping on the pane background lands in the folder it is anchored to —
    // the gesture for moving something *out* of a subfolder.
    fireEvent.drop(pane, {
      dataTransfer: {
        types: ['application/x-grimoire-paths'],
        getData: () => JSON.stringify({ paths: ['maps/tavern.png'], from: 'maps' }),
      },
    })

    await waitFor(() => expect(filesApi.move).toHaveBeenCalledWith(['maps/tavern.png'], 'books'))
  })

  it('warns when only some of the selection moved', async () => {
    filesApi.move.mockResolvedValue({
      moved: [{}],
      skipped: [{ path: 'books/core', reason: 'exists', code: 'conflict' }],
      count: 1,
    })
    render(<FileManagerView />)
    await pinRight()

    const pane = screen.getByTestId('file-pane-primary')
    await userEvent.click(within(pane).getByTestId('entry-bestiary.pdf'))
    await userEvent.click(screen.getByTitle('files.moveAcrossHint'))

    expect(await screen.findByRole('status')).toHaveTextContent('files.movedWithSkips')
  })

  it('moves a selection from the pinned pane back into the primary', async () => {
    filesApi.move.mockResolvedValue({ moved: [{}], skipped: [], count: 1 })
    render(<FileManagerView />)
    const second = await pinRight()

    await userEvent.click(within(second).getByTestId('entry-bestiary.pdf'))
    const buttons = screen.getAllByTitle('files.moveAcrossHint')
    await userEvent.click(buttons[buttons.length - 1])

    await waitFor(() =>
      expect(filesApi.move).toHaveBeenCalledWith(['books/core/bestiary.pdf'], 'books')
    )
  })

  it('refreshes on demand', async () => {
    render(<FileManagerView />)
    await screen.findByTestId('file-pane-primary')
    filesApi.browse.mockClear()

    await userEvent.click(screen.getByText('files.refresh'))
    await waitFor(() => expect(filesApi.browse).toHaveBeenCalledTimes(1))
  })

  it('refreshes both panes after a successful mutation', async () => {
    filesApi.move.mockResolvedValue({ moved: [{}], skipped: [], count: 1 })
    render(<FileManagerView />)
    await pinRight()

    const pane = screen.getByTestId('file-pane-primary')
    await userEvent.click(within(pane).getByTestId('entry-bestiary.pdf'))
    filesApi.browse.mockClear()
    await userEvent.click(screen.getByTitle('files.moveAcrossHint'))

    // Both source and destination change, and either pane may be showing either.
    await waitFor(() => expect(filesApi.browse).toHaveBeenCalledTimes(2))
  })

  it('closes the primary pane and keeps the pinned folder', async () => {
    render(<FileManagerView />)
    await pinRight()

    // Either × is offered, and closing the primary keeps what the user pinned
    // rather than discarding it.
    await userEvent.click(screen.getByTestId('close-pane-primary'))

    expect(screen.getByTestId('split-none')).toBeInTheDocument()
    await waitFor(() => expect(filesApi.browse).toHaveBeenCalledWith('books/core'))
  })

  it('offers a close button on both panes once split', async () => {
    render(<FileManagerView />)
    await pinRight()
    expect(screen.getByTestId('close-pane-primary')).toBeInTheDocument()
    expect(screen.getByTestId('close-pane-secondary')).toBeInTheDocument()
  })

  it('hides a singleton container kind that another folder already claims', async () => {
    filesApi.browse.mockImplementation((path) =>
      Promise.resolve(
        browseResult([folder('core', path)], path, {
          singletons_taken: { 'one-page': 'books/One Page RPGs' },
        })
      )
    )
    render(<FileManagerView />)
    await openMenuOn('core')
    await openSubmenu('container-submenu')

    // Two one-page collections would each claim to be the home of every tiny
    // game, so the taken kind is not offered on a different folder.
    expect(await screen.findByTestId('kind-agnostic')).toBeInTheDocument()
    expect(screen.queryByTestId('kind-one-page')).not.toBeInTheDocument()
  })

  it('lets the holder of a singleton kind change away from it', async () => {
    filesApi.browse.mockImplementation((path) =>
      Promise.resolve(
        browseResult([folder('core', path, { container_kind: 'one-page' })], path, {
          singletons_taken: { 'one-page': 'books/core' },
        })
      )
    )
    render(<FileManagerView />)
    await openMenuOn('core')
    await openSubmenu('container-submenu')

    // Its own kind is omitted (that is not a change), but every other kind —
    // including clearing it — must remain reachable, or the collection could
    // never be moved elsewhere.
    expect(await screen.findByTestId('kind-none')).toBeInTheDocument()
    expect(screen.getByTestId('kind-agnostic')).toBeInTheDocument()
    expect(screen.queryByTestId('kind-one-page')).not.toBeInTheDocument()
  })

  it('scaffolds category folders for a system folder', async () => {
    filesApi.scaffold.mockResolvedValue({ path: 'books/core', created: ['Core'], existing: [] })
    render(<FileManagerView />)
    await openMenuOn('core')

    await userEvent.click(await screen.findByTestId('scaffold-categories'))

    await waitFor(() => expect(filesApi.scaffold).toHaveBeenCalledWith('books/core'))
    expect(await screen.findByRole('status')).toHaveTextContent('files.scaffolded')
  })

  it('says when the category folders already existed', async () => {
    filesApi.scaffold.mockResolvedValue({ path: 'books/core', created: [], existing: ['Core'] })
    render(<FileManagerView />)
    await openMenuOn('core')
    await userEvent.click(await screen.findByTestId('scaffold-categories'))

    expect(await screen.findByRole('status')).toHaveTextContent('files.scaffoldNothingToDo')
  })

  it('opens the shared metadata editor for an indexed file', async () => {
    filesApi.record.mockResolvedValue({ id: 'rec-1', title: 'Bestiary' })
    render(<FileManagerView />)
    await openMenuOn('bestiary.pdf')

    await userEvent.click(await screen.findByTestId('edit-metadata'))

    // The API names collections by folder ("books"); the editor keys by type.
    await waitFor(() => expect(filesApi.record).toHaveBeenCalledWith('book', 'rec-1'))
    expect(await screen.findByTestId('metadata-modal')).toBeInTheDocument()
    expect(screen.getByTestId('metadata-title')).toHaveTextContent('Bestiary')
  })

  it('offers metadata edit on a system folder', async () => {
    // books/<system> folders map to a GameSystem row, which carries editable
    // metadata even though the folder is not an indexed file.
    filesApi.browse.mockImplementation((path) =>
      Promise.resolve(
        browseResult(
          [folder('core', path, { record_id: 'sys-1', collection: 'system', title: 'Core' })],
          path
        )
      )
    )
    filesApi.record.mockResolvedValue({ id: 'sys-1', title: 'Core' })
    render(<FileManagerView />)
    await openMenuOn('core')

    await userEvent.click(await screen.findByTestId('edit-metadata'))

    await waitFor(() => expect(filesApi.record).toHaveBeenCalledWith('system', 'sys-1'))
    expect(await screen.findByTestId('metadata-modal')).toBeInTheDocument()
  })

  it('offers no metadata edit for a folder with no record', async () => {
    render(<FileManagerView />)
    await openMenuOn('core')
    // An unregistered folder has nothing to edit.
    expect(screen.queryByTestId('edit-metadata')).not.toBeInTheDocument()
  })

  it('refuses to open the editor for a type it cannot render', async () => {
    // The editor looks up its field list by type and threw on a miss, blanking
    // the page. An unknown type must produce a message, not a white screen.
    filesApi.browse.mockImplementation((path) =>
      Promise.resolve(
        browseResult([folder('core', path, { record_id: 'x1', collection: 'campaign' })], path)
      )
    )
    render(<FileManagerView />)
    await openMenuOn('core')
    await userEvent.click(await screen.findByTestId('edit-metadata'))

    expect(await screen.findByRole('status')).toHaveTextContent('files.metadataUnsupported')
    expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument()
    expect(filesApi.record).not.toHaveBeenCalled()
  })

  it('reports a record that comes back empty instead of opening a blank editor', async () => {
    filesApi.record.mockResolvedValue(null)
    render(<FileManagerView />)
    await openMenuOn('bestiary.pdf')
    await userEvent.click(await screen.findByTestId('edit-metadata'))

    expect(await screen.findByRole('status')).toHaveTextContent('files.metadataLoadFailed')
    expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument()
  })

  it("omits the folder's current container type from the submenu", async () => {
    filesApi.browse.mockImplementation((path) =>
      Promise.resolve(browseResult([folder('core', path, { container_kind: 'publisher' })], path))
    )
    render(<FileManagerView />)
    await openMenuOn('core')
    await openSubmenu('container-submenu')

    // The submenu lists changes to make; the kind it already has is not one.
    expect(await screen.findByTestId('kind-parent')).toBeInTheDocument()
    expect(screen.queryByTestId('kind-publisher')).not.toBeInTheDocument()
    // "Not a container" stays, since clearing the kind is a real change.
    expect(screen.getByTestId('kind-none')).toBeInTheDocument()
  })

  it('omits "Not a container" for a folder that is not one', async () => {
    render(<FileManagerView />)
    await openMenuOn('core')
    await openSubmenu('container-submenu')

    await screen.findByTestId('kind-parent')
    expect(screen.queryByTestId('kind-none')).not.toBeInTheDocument()
  })

  it('reports a metadata load failure instead of opening an empty editor', async () => {
    filesApi.record.mockRejectedValue(new Error('Not found'))
    render(<FileManagerView />)
    await openMenuOn('bestiary.pdf')
    await userEvent.click(await screen.findByTestId('edit-metadata'))

    expect(await screen.findByRole('status')).toHaveTextContent('Not found')
    expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument()
  })

  it('uploads files dragged in from the desktop', async () => {
    render(<FileManagerView />)
    const pane = await screen.findByTestId('file-pane-primary')

    const dropped = [new File(['x'], 'new.pdf', { type: 'application/pdf' })]
    fireEvent.drop(pane, {
      dataTransfer: {
        types: ['Files'],
        files: dropped,
        getData: () => '',
      },
    })

    // Files from the desktop are an upload, not a move — the two share the drop
    // target and must not be confused.
    await waitFor(() => expect(uploadQueue.enqueue).toHaveBeenCalled())
    const [entries, destination] = uploadQueue.enqueue.mock.calls[0]
    expect(entries[0].file.name).toBe('new.pdf')
    expect(destination).toBe('books')
    expect(filesApi.move).not.toHaveBeenCalled()
  })

  it('queues files chosen from the picker into the right-clicked folder', async () => {
    render(<FileManagerView />)
    await openMenuOn('core')
    await userEvent.click(await screen.findByTestId('upload-files'))

    const input = screen.getByTestId('file-input')
    const file = new File(['x'], 'phb.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(uploadQueue.enqueue).toHaveBeenCalled())
    // The destination is the folder the menu was opened on, not an ambiguous
    // "current" folder.
    expect(uploadQueue.enqueue.mock.calls[0][1]).toBe('books/core')
  })

  it("keeps a folder upload's structure", async () => {
    render(<FileManagerView />)
    await openMenuOn('core')
    await userEvent.click(await screen.findByTestId('upload-folder'))

    const file = new File(['x'], 'phb.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Core Rules/2024/phb.pdf' })
    fireEvent.change(screen.getByTestId('folder-input'), { target: { files: [file] } })

    await waitFor(() => expect(uploadQueue.enqueue).toHaveBeenCalled())
    expect(uploadQueue.enqueue.mock.calls[0][0][0].relativeDir).toBe('Core Rules/2024')
  })

  it('shows the upload panel once files are queued', async () => {
    render(<FileManagerView />)
    await openMenuOn('core')
    await userEvent.click(await screen.findByTestId('upload-files'))

    uploadQueue.items = [
      { id: 'u1', name: 'a.pdf', size: 1, status: 'uploading', progress: 0.5, error: null },
    ]
    uploadQueue.counts = { queued: 0, uploading: 1, done: 0, error: 0, cancelled: 0 }
    uploadQueue.inFlight = 1

    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['x'], 'a.pdf')] },
    })

    expect(await screen.findByTestId('upload-panel')).toBeInTheDocument()
  })

  it('offers no upload actions on a file', async () => {
    render(<FileManagerView />)
    await openMenuOn('bestiary.pdf')
    // Uploads go *into* a folder; a file is not a destination.
    expect(screen.queryByTestId('upload-files')).not.toBeInTheDocument()
    expect(screen.queryByTestId('upload-folder')).not.toBeInTheDocument()
  })

  it('falls back to the pane folder when no destination was set', async () => {
    render(<FileManagerView />)
    await screen.findByTestId('file-pane-primary')

    // A change event that arrives without the picker having set a target must
    // still land somewhere sensible rather than failing with "Path is empty".
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['x'], 'stray.pdf')] },
    })

    await waitFor(() => expect(uploadQueue.enqueue).toHaveBeenCalled())
    expect(uploadQueue.enqueue.mock.calls[0][1]).toBe('books')
  })
})
