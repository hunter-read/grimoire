import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SheetsTab from './SheetsTab'

const mockImportSchema = vi.fn()
const mockDeleteSchema = vi.fn()

vi.mock('../../api', () => ({
  characters: {
    importSchema: (...a) => mockImportSchema(...a),
    deleteSchema: (...a) => mockDeleteSchema(...a),
  },
}))

const SCHEMA = {
  schema_id: 'dnd-5e',
  name: 'D&D 5e',
  system: 'D&D',
  version: '1.0.0',
  is_community: true,
  character_count: 2,
}

const renderTab = (props = {}) =>
  render(
    <SheetsTab
      schemas={[SCHEMA]}
      onChanged={vi.fn()}
      onBrowse={vi.fn()}
      setError={vi.fn()}
      {...props}
    />
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockImportSchema.mockResolvedValue({ schema_id: 'pasted', name: 'Pasted' })
  mockDeleteSchema.mockResolvedValue({ deleted: true })
})

describe('SheetsTab', () => {
  it('lists an installed sheet with where it came from', () => {
    renderTab()
    expect(screen.getByText('D&D 5e')).toBeInTheDocument()
    // Provenance decides whether uninstalling can be undone by browsing.
    expect(screen.getByText(/from the catalogue/i)).toBeInTheDocument()
    expect(screen.getByText(/2 characters/i)).toBeInTheDocument()
  })

  it('marks a pasted sheet as pasted', () => {
    renderTab({ schemas: [{ ...SCHEMA, is_community: false, character_count: 0 }] })
    expect(screen.getByText(/pasted/i)).toBeInTheDocument()
  })

  it('shows an empty state when nothing is installed', () => {
    renderTab({ schemas: [] })
    expect(screen.getByText(/No sheets yet/i)).toBeInTheDocument()
  })

  it('opens the catalogue through its callback', async () => {
    const onBrowse = vi.fn()
    renderTab({ onBrowse })
    await userEvent.click(screen.getByText('Browse sheets'))
    expect(onBrowse).toHaveBeenCalled()
  })

  it('sends a pasted sheet as text rather than parsing it here', async () => {
    // Parsed server-side so one parser decides what is valid - and so YAML
    // works without shipping a YAML parser to the browser.
    renderTab()
    await userEvent.click(screen.getByText('Paste a sheet'))
    await userEvent.type(screen.getByLabelText(/Sheet \(JSON or YAML\)/i), 'id: x')
    await userEvent.click(screen.getByText('Install'))

    await waitFor(() =>
      expect(mockImportSchema).toHaveBeenCalledWith({ text: 'id: x', layout: '', styles: '' })
    )
  })

  it('sends a layout and stylesheet alongside the document', async () => {
    renderTab()
    await userEvent.click(screen.getByText('Paste a sheet'))
    await userEvent.type(screen.getByLabelText(/Sheet \(JSON or YAML\)/i), 'id: x')
    await userEvent.type(screen.getByLabelText(/Layout \(HTML\)/i), '<div></div>')
    await userEvent.type(screen.getByLabelText(/Stylesheet \(CSS\)/i), '.sheet{{}')
    await userEvent.click(screen.getByText('Install'))

    await waitFor(() =>
      expect(mockImportSchema).toHaveBeenCalledWith({
        text: 'id: x',
        layout: '<div></div>',
        styles: '.sheet{}',
      })
    )
  })

  it('confirms the install and refreshes the list', async () => {
    const onChanged = vi.fn()
    renderTab({ onChanged })
    await userEvent.click(screen.getByText('Paste a sheet'))
    await userEvent.type(screen.getByLabelText(/Sheet \(JSON or YAML\)/i), 'id: x')
    await userEvent.click(screen.getByText('Install'))

    expect(await screen.findByRole('status')).toHaveTextContent(/Pasted installed/i)
    expect(onChanged).toHaveBeenCalled()
  })

  it('reports a server-side parse failure rather than guessing', async () => {
    const setError = vi.fn()
    mockImportSchema.mockRejectedValue(new Error('That sheet is not valid JSON or YAML'))
    renderTab({ setError })
    await userEvent.click(screen.getByText('Paste a sheet'))
    await userEvent.type(screen.getByLabelText(/Sheet \(JSON or YAML\)/i), 'nope: x')
    await userEvent.click(screen.getByText('Install'))

    await waitFor(() =>
      expect(setError).toHaveBeenCalledWith('That sheet is not valid JSON or YAML')
    )
  })

  it('will not submit an empty document', async () => {
    renderTab()
    await userEvent.click(screen.getByText('Paste a sheet'))
    expect(screen.getByText('Install').closest('button')).toBeDisabled()
  })

  it('uninstalls a sheet after confirming', async () => {
    const onChanged = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderTab({ onChanged })
    await userEvent.click(screen.getByLabelText(/Uninstall D&D 5e/i))
    await waitFor(() => expect(mockDeleteSchema).toHaveBeenCalledWith('dnd-5e'))
    expect(onChanged).toHaveBeenCalled()
  })

  it('does not uninstall when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderTab()
    await userEvent.click(screen.getByLabelText(/Uninstall D&D 5e/i))
    expect(mockDeleteSchema).not.toHaveBeenCalled()
  })

  it('says characters survive an uninstall', async () => {
    // The confirmation has to say so, because the button otherwise reads as
    // "delete my characters".
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderTab()
    await userEvent.click(screen.getByLabelText(/Uninstall D&D 5e/i))
    expect(confirm.mock.calls[0][0]).toMatch(/kept/i)
  })
})
