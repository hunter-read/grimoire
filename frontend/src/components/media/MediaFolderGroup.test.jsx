import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MediaFolderGroup from './MediaFolderGroup'
import { MEDIA_CONFIGS } from './mediaConfig'

const playQueue = vi.fn()
vi.mock('../../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({ playQueue }),
}))
vi.mock('../../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))
vi.mock('./MediaCard', () => ({ default: ({ item }) => <div>{item.filename}</div> }))
vi.mock('../LazyGrid', () => ({ default: ({ children }) => <>{children}</> }))
vi.mock('../RescanButton', () => ({ default: () => <span data-testid="rescan" /> }))
// Real-ish FolderTagRow: exposes its edit + save affordances so the editing
// branches of the folder group are exercised.
vi.mock('./FolderTagRow', () => ({
  default: ({ editing, onEdit, onSave, onCancel }) =>
    editing ? (
      <span>
        <button data-testid="save-folder-tags" onClick={() => onSave(['t'])}>
          save
        </button>
        <button data-testid="cancel-folder-tags" onClick={onCancel}>
          cancel
        </button>
      </span>
    ) : (
      <button data-testid="edit-folder-tags" onClick={onEdit}>
        edit
      </button>
    ),
}))

const baseProps = (over = {}) => ({
  collapsed: new Set(),
  onToggle: vi.fn(),
  folderTags: {},
  editingFolder: null,
  onSetEditingFolder: vi.fn(),
  onSaveFolderTags: vi.fn(),
  onSelectItem: vi.fn(),
  bulkMode: false,
  selectedIds: new Set(),
  selectedFolderPaths: new Set(),
  onToggleItem: vi.fn(),
  onToggleFolder: vi.fn(),
  onDownload: vi.fn(),
  ...over,
})

const audioItems = [
  { id: 'a1', filename: 't1.mp3', title: 'One', has_artwork: false, is_missing: false },
  { id: 'a2', filename: 't2.mp3', title: 'Two', has_artwork: true, is_missing: false },
  { id: 'a3', filename: 'missing.mp3', title: 'Gone', is_missing: true },
]

describe('MediaFolderGroup — audio', () => {
  it('shows a Play button that queues non-missing tracks', async () => {
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.audio}
        folder="Ambient"
        subfolders={{ '': audioItems }}
        {...baseProps()}
      />
    )
    const playBtn = screen.getByTitle(/play ambient/i)
    await userEvent.click(playBtn)
    expect(playQueue).toHaveBeenCalledTimes(1)
    const queued = playQueue.mock.calls[0][0]
    // The missing track is excluded.
    expect(queued.map((t) => t.id)).toEqual(['a1', 'a2'])
  })

  it('does not show a Play button for a non-audio gallery (maps)', () => {
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{ '': [{ id: 'm1', filename: 'm.png' }] }}
        {...baseProps()}
      />
    )
    expect(screen.queryByTitle(/^play /i)).not.toBeInTheDocument()
  })

  it('renders named subfolders and their items', () => {
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{
          '': [{ id: 'm1', filename: 'root.png' }],
          caves: [{ id: 'm2', filename: 'cave.png' }],
        }}
        {...baseProps()}
      />
    )
    expect(screen.getByText('root.png')).toBeInTheDocument()
    expect(screen.getByText('cave.png')).toBeInTheDocument()
    // The subfolder name is shown (title-cased).
    expect(screen.getByText(/caves/i)).toBeInTheDocument()
  })

  it('fires onDownload when the folder download button is clicked', async () => {
    const onDownload = vi.fn()
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{ '': [{ id: 'm1', filename: 'm.png' }] }}
        {...baseProps({ onDownload })}
      />
    )
    await userEvent.click(screen.getByTitle(/download all maps/i))
    expect(onDownload).toHaveBeenCalled()
  })

  it('collapses when the header toggle is clicked', async () => {
    const onToggle = vi.fn()
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{ '': [{ id: 'm1', filename: 'm.png' }] }}
        {...baseProps({ onToggle })}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /collapse dungeons/i }))
    expect(onToggle).toHaveBeenCalledWith('Dungeons')
  })

  it('renders in bulk mode without the download/play controls', () => {
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.audio}
        folder="Ambient"
        subfolders={{ '': [{ id: 'a1', filename: 't.mp3', is_missing: false }] }}
        {...baseProps({ bulkMode: true })}
      />
    )
    // In bulk mode the folder download + play buttons are hidden.
    expect(screen.queryByTitle(/^play /i)).not.toBeInTheDocument()
    expect(screen.queryByTitle(/download all/i)).not.toBeInTheDocument()
    // The folder name still renders.
    expect(screen.getByText(/ambient/i)).toBeInTheDocument()
  })

  it('downloads a named subfolder via its download button', async () => {
    const onDownload = vi.fn()
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{ caves: [{ id: 'm2', filename: 'cave.png' }] }}
        {...baseProps({ onDownload })}
      />
    )
    await userEvent.click(screen.getByTitle(/download maps in caves/i))
    expect(onDownload).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ folder: 'Dungeons/caves' }) })
    )
  })

  it('collapses a subfolder when its toggle is clicked', async () => {
    const onToggle = vi.fn()
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{ caves: [{ id: 'm2', filename: 'cave.png' }] }}
        {...baseProps({ onToggle })}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /collapse caves/i }))
    expect(onToggle).toHaveBeenCalledWith('Dungeons::caves')
  })

  it('edits root folder tags', async () => {
    const onSaveFolderTags = vi.fn()
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{ '': [{ id: 'm1', filename: 'm.png' }] }}
        {...baseProps({ onSaveFolderTags })}
      />
    )
    await userEvent.click(screen.getAllByTestId('edit-folder-tags')[0])
    await userEvent.click(screen.getByTestId('save-folder-tags'))
    expect(onSaveFolderTags).toHaveBeenCalledWith('Dungeons', ['t'])
  })

  it('starts editing a subfolder tag row', async () => {
    const onSetEditingFolder = vi.fn()
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{ caves: [{ id: 'm2', filename: 'cave.png' }] }}
        {...baseProps({ onSetEditingFolder })}
      />
    )
    // Click the subfolder's (non-editing) tag-row edit affordance.
    const edits = screen.getAllByTestId('edit-folder-tags')
    await userEvent.click(edits[edits.length - 1])
    expect(onSetEditingFolder).toHaveBeenCalledWith('Dungeons::caves')
  })

  it('saves and cancels a subfolder tag edit via editingFolder', async () => {
    const onSaveFolderTags = vi.fn()
    const onSetEditingFolder = vi.fn()
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{ caves: [{ id: 'm2', filename: 'cave.png' }] }}
        {...baseProps({
          editingFolder: 'Dungeons::caves',
          onSaveFolderTags,
          onSetEditingFolder,
        })}
      />
    )
    await userEvent.click(screen.getByTestId('save-folder-tags'))
    expect(onSaveFolderTags).toHaveBeenCalledWith('Dungeons/caves', ['t'])
    await userEvent.click(screen.getByTestId('cancel-folder-tags'))
    expect(onSetEditingFolder).toHaveBeenCalledWith(null)
  })

  it('plays an audio folder including its subfolder tracks', async () => {
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.audio}
        folder="Ambient"
        subfolders={{
          '': [{ id: 'a1', filename: 't1.mp3', is_missing: false }],
          battle: [{ id: 'a2', filename: 't2.mp3', is_missing: false }],
        }}
        {...baseProps()}
      />
    )
    await userEvent.click(screen.getByTitle(/play ambient/i))
    const queued = playQueue.mock.calls[0][0].map((t) => t.id)
    expect(queued).toEqual(['a1', 'a2'])
  })
})
