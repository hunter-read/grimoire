import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MEDIA_CONFIGS } from './mediaConfig'

// `isMobilePhone` is read once at module load, so stub matchMedia to report a
// phone BEFORE importing the component, then load it dynamically. This exercises
// the mobile-only branches that the desktop test can't reach.
vi.mock('../../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({ playQueue: vi.fn() }),
}))
vi.mock('../../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))
vi.mock('./MediaCard', () => ({ default: ({ item }) => <div>{item.filename}</div> }))
vi.mock('../LazyGrid', () => ({ default: ({ children }) => <>{children}</> }))
vi.mock('../RescanButton', () => ({ default: () => null }))
// Fire the tag-row callbacks so the inline arrow handlers are exercised.
vi.mock('./FolderTagRow', () => ({
  default: ({ onEdit, onSave, onCancel }) => (
    <span data-testid="tag-row">
      <button data-testid="tr-edit" onClick={onEdit} />
      <button data-testid="tr-save" onClick={() => onSave?.(['x'])} />
      <button data-testid="tr-cancel" onClick={onCancel} />
    </span>
  ),
}))

let MediaFolderGroup

beforeAll(async () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addListener: vi.fn() })
  vi.resetModules()
  MediaFolderGroup = (await import('./MediaFolderGroup')).default
})

const baseProps = {
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
}

describe('MediaFolderGroup (mobile branches)', () => {
  it('renders mobile tag rows for a folder with a subfolder', () => {
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{
          '': [{ id: 'm1', filename: 'root.png' }],
          caves: [{ id: 'm2', filename: 'cave.png' }],
        }}
        {...baseProps}
      />
    )
    expect(screen.getByText('root.png')).toBeInTheDocument()
    expect(screen.getByText('cave.png')).toBeInTheDocument()
    // Mobile renders the tag rows under the (expanded) folder/subfolder.
    expect(screen.getAllByTestId('tag-row').length).toBeGreaterThan(0)
  })

  it('fires the mobile tag-row edit/save/cancel callbacks', async () => {
    const onSaveFolderTags = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{ caves: [{ id: 'm2', filename: 'cave.png' }] }}
        {...baseProps}
        onSaveFolderTags={onSaveFolderTags}
      />
    )
    const edits = screen.getAllByTestId('tr-edit')
    await userEvent.click(edits[0])
    const saves = screen.getAllByTestId('tr-save')
    await userEvent.click(saves[0])
    expect(onSaveFolderTags).toHaveBeenCalled()
    const cancels = screen.getAllByTestId('tr-cancel')
    await userEvent.click(cancels[0])
  })

  it('fires mobile subfolder tag save/cancel when that subfolder is editing', async () => {
    const onSaveFolderTags = vi.fn()
    const onSetEditingFolder = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    render(
      <MediaFolderGroup
        config={MEDIA_CONFIGS.map}
        folder="Dungeons"
        subfolders={{ caves: [{ id: 'm2', filename: 'cave.png' }] }}
        {...baseProps}
        editingFolder="Dungeons::caves"
        onSaveFolderTags={onSaveFolderTags}
        onSetEditingFolder={onSetEditingFolder}
      />
    )
    // The editing subfolder row exposes save + cancel.
    await userEvent.click(screen.getAllByTestId('tr-save').at(-1))
    expect(onSaveFolderTags).toHaveBeenCalledWith('Dungeons/caves', ['x'])
    await userEvent.click(screen.getAllByTestId('tr-cancel').at(-1))
    expect(onSetEditingFolder).toHaveBeenCalledWith(null)
  })
})
