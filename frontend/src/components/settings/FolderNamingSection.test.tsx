import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FolderNamingSection from './FolderNamingSection'
import { naming, type Schema } from '../../api'

vi.mock('../../api', () => ({
  naming: { folders: vi.fn(), deleteFolder: vi.fn() },
}))

vi.mock('./FolderNamingDialog', () => ({
  default: ({
    rule,
    onClose,
    onSaved,
  }: {
    rule?: { path: string }
    onClose: () => void
    onSaved: () => void
  }) => (
    <div>
      dialog for {rule ? rule.path : 'a new rule'}
      <button type="button" onClick={onSaved}>
        dialog-save
      </button>
      <button type="button" onClick={onClose}>
        dialog-close
      </button>
    </div>
  ),
}))

const body = (rules: Schema<'FolderRuleOut'>[]) => ({
  rules,
  fields: ['title'],
  read_fields: ['title'],
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FolderNamingSection', () => {
  it('says when no folder has a pattern', async () => {
    vi.mocked(naming.folders).mockResolvedValue(body([]))
    render(<FolderNamingSection />)
    expect(await screen.findByText('No folder has a naming pattern yet.')).toBeInTheDocument()
  })

  it('lists each rule with what is wrong with it', async () => {
    vi.mocked(naming.folders).mockResolvedValue(
      body([
        { path: 'books/A', pattern: '{*} - {title}', exists: true, renderable: false },
        { path: 'books/B', pattern: '{title}', exists: false, renderable: true },
        {
          path: 'books/C',
          pattern: '{bad}',
          exists: true,
          renderable: false,
          error: 'Unknown field',
        },
      ])
    )
    render(<FolderNamingSection />)
    expect(await screen.findByText('books/A')).toBeInTheDocument()
    expect(screen.getByText('{*} - {title}')).toBeInTheDocument()
    expect(screen.getByText('Reads only')).toBeInTheDocument()
    expect(screen.getByText('Folder not found')).toBeInTheDocument()
    expect(screen.getByText('Pattern error: Unknown field')).toBeInTheDocument()
  })

  it('reports a failed load', async () => {
    vi.mocked(naming.folders).mockRejectedValue(new Error(''))
    render(<FolderNamingSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load folder patterns.')
  })

  it('opens the dialog for a new rule and for an existing one, and reloads on save', async () => {
    vi.mocked(naming.folders).mockResolvedValue(
      body([{ path: 'books/A', pattern: '{title}', exists: true, renderable: true }])
    )
    render(<FolderNamingSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add folder pattern' }))
    expect(screen.getByText('dialog for a new rule')).toBeInTheDocument()
    fireEvent.click(screen.getByText('dialog-close'))

    fireEvent.click(screen.getByRole('button', { name: 'Edit the pattern for books/A' }))
    expect(screen.getByText('dialog for books/A')).toBeInTheDocument()
    fireEvent.click(screen.getByText('dialog-save'))
    await waitFor(() => expect(naming.folders).toHaveBeenCalledTimes(2))
  })

  it('removes a rule after confirmation', async () => {
    vi.mocked(naming.folders).mockResolvedValue(
      body([{ path: 'books/A', pattern: '{title}', exists: true, renderable: true }])
    )
    vi.mocked(naming.deleteFolder).mockResolvedValue({ status: 'ok' })
    render(<FolderNamingSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the pattern for books/A' }))
    expect(screen.getByText(/Remove the naming pattern from books\/A\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(naming.deleteFolder).toHaveBeenCalledWith('books/A'))
    await waitFor(() => expect(naming.folders).toHaveBeenCalledTimes(2))
  })

  it('reports a failed removal', async () => {
    vi.mocked(naming.folders).mockResolvedValue(
      body([{ path: 'books/A', pattern: '{title}', exists: true, renderable: true }])
    )
    vi.mocked(naming.deleteFolder).mockRejectedValue(new Error(''))
    render(<FolderNamingSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the pattern for books/A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove the pattern.')
  })
})
