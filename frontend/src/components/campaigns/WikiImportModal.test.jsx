import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WikiImportModal from './WikiImportModal'

vi.mock('../../api', () => ({
  campaigns: {
    importWiki: vi.fn(),
    importWikiFolder: vi.fn(),
  },
}))

import { campaigns } from '../../api'

/** A picked file carrying its path within the picked folder. */
function pickedFile(path, body = '# Hi') {
  const file = new File([body], path.split('/').pop(), { type: 'text/markdown' })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

function renderModal(props = {}) {
  return render(
    <WikiImportModal campaignId="c1" onClose={vi.fn()} onImported={vi.fn()} {...props} />
  )
}

describe('WikiImportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the import dialog with format guidance', () => {
    renderModal()
    expect(screen.getByText('Import wiki pages')).toBeTruthy()
    expect(screen.getByText(/Accepts .zip/)).toBeTruthy()
  })

  it('accepts LegendKeeper .lk files in the picker', () => {
    const { container } = renderModal()
    const input = container.querySelector('input[type="file"]')
    expect(input.getAttribute('accept')).toContain('.lk')
  })

  it('imports a chosen file and shows the result count', async () => {
    campaigns.importWiki.mockResolvedValue({ imported: 3, format: 'markdown', pages: [] })
    const onImported = vi.fn()
    const { container } = renderModal({ onImported })

    const file = new File(['# Hi'], 'notes.md', { type: 'text/markdown' })
    const input = container.querySelector('input[type="file"]')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(campaigns.importWiki).toHaveBeenCalledWith('c1', file))
    await waitFor(() => expect(screen.getByText('Imported 3 pages')).toBeTruthy())
    expect(onImported).toHaveBeenCalled()
  })

  it('shows an error when the import fails', async () => {
    campaigns.importWiki.mockRejectedValue(new Error('Unrecognised JSON format'))
    const { container } = renderModal()

    const file = new File(['{}'], 'bad.json', { type: 'application/json' })
    const input = container.querySelector('input[type="file"]')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText('Unrecognised JSON format')).toBeTruthy())
  })

  it('offers a folder picker alongside the file picker', () => {
    const { container } = renderModal()
    expect(screen.getByText('Choose folder')).toBeTruthy()
    const folder = container.querySelector('[data-testid="wiki-folder-input"]')
    // `webkitdirectory` is what makes the browser report each file's path.
    expect(folder.hasAttribute('webkitdirectory')).toBe(true)
  })

  it('sends a picked folder with each file path so nesting survives', async () => {
    campaigns.importWikiFolder.mockResolvedValue({ imported: 4, format: 'markdown', pages: [] })
    const onImported = vi.fn()
    const { container } = renderModal({ onImported })

    const a = pickedFile('Vault/Places/Barovia.md')
    const b = pickedFile('Vault/Notes.md')
    const folder = container.querySelector('[data-testid="wiki-folder-input"]')
    fireEvent.change(folder, { target: { files: [a, b] } })

    await waitFor(() =>
      expect(campaigns.importWikiFolder).toHaveBeenCalledWith('c1', [
        { file: a, path: 'Vault/Places/Barovia.md' },
        { file: b, path: 'Vault/Notes.md' },
      ])
    )
    await waitFor(() => expect(screen.getByText('Imported 4 pages')).toBeTruthy())
    expect(onImported).toHaveBeenCalled()
  })

  it('drops dot-directories and non-markdown from a picked folder', async () => {
    campaigns.importWikiFolder.mockResolvedValue({ imported: 1, format: 'markdown', pages: [] })
    const { container } = renderModal()

    const real = pickedFile('Vault/Real.md')
    const template = pickedFile('Vault/.obsidian/templates/Daily.md')
    const image = pickedFile('Vault/map.png')
    const folder = container.querySelector('[data-testid="wiki-folder-input"]')
    fireEvent.change(folder, { target: { files: [real, template, image] } })

    await waitFor(() =>
      expect(campaigns.importWikiFolder).toHaveBeenCalledWith('c1', [
        { file: real, path: 'Vault/Real.md' },
      ])
    )
  })

  it('reports a folder with no markdown instead of posting nothing', async () => {
    const { container } = renderModal()
    const folder = container.querySelector('[data-testid="wiki-folder-input"]')
    fireEvent.change(folder, { target: { files: [pickedFile('Vault/map.png')] } })

    await waitFor(() => expect(screen.getByText(/no Markdown files/)).toBeTruthy())
    expect(campaigns.importWikiFolder).not.toHaveBeenCalled()
  })

  it('shows an error when a folder import fails', async () => {
    campaigns.importWikiFolder.mockRejectedValue(new Error('Folder is too large'))
    const { container } = renderModal()
    const folder = container.querySelector('[data-testid="wiki-folder-input"]')
    fireEvent.change(folder, { target: { files: [pickedFile('Vault/Real.md')] } })

    await waitFor(() => expect(screen.getByText('Folder is too large')).toBeTruthy())
  })
})
