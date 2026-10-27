import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CharacterImportDialog from './CharacterImportDialog'

const mockListImporters = vi.fn()
const mockImport = vi.fn()
const mockImportExternal = vi.fn()
const mockInstallImporter = vi.fn()

vi.mock('../../api', () => ({
  characters: {
    listImporters: (...a: unknown[]) => mockListImporters(...a),
    import: (...a: unknown[]) => mockImport(...a),
    importExternal: (...a: unknown[]) => mockImportExternal(...a),
    installImporter: (...a: unknown[]) => mockInstallImporter(...a),
  },
}))

const FORGE = {
  id: 'forge-steel',
  name: 'Forge Steel',
  description: 'Draw Steel heroes.',
  homepage: 'https://forgesteel.net',
  attribution: 'Forge Steel by Andy Aiken',
  sheet: 'draw-steel',
  sheet_name: 'Draw Steel',
  sheet_installed: true,
  extensions: ['.ds-hero', '.json'],
  accepts_files: true,
  accepts_url: false,
  url_hint: '',
}
const LINKED = {
  ...FORGE,
  id: 'linked',
  name: 'Linked Builder',
  homepage: '',
  description: '',
  attribution: '',
  sheet: 'pathfinder-2e',
  sheet_name: '',
  sheet_installed: false,
  extensions: [],
  accepts_url: true,
  url_hint: 'https://builder.test/c/123',
}

const fileOf = (text: string, name = 'hero.ds-hero', size?: number) => {
  const file = new File([text], name)
  // jsdom's File has no text(), which is what the dialog reads it with.
  file.text = () => Promise.resolve(text)
  if (size) Object.defineProperty(file, 'size', { value: size })
  return file
}

function renderDialog() {
  const onImported = vi.fn()
  const onClose = vi.fn()
  render(<CharacterImportDialog onImported={onImported} onClose={onClose} />)
  return { onImported, onClose }
}

describe('CharacterImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListImporters.mockResolvedValue({ importers: [FORGE] })
  })

  it('lists the installed importers with their sheet and credit', async () => {
    mockListImporters.mockResolvedValue({ importers: [FORGE, LINKED] })
    renderDialog()
    await userEvent.click(await screen.findByRole('button', { name: 'Installed importers (2)' }))
    expect(screen.getByText(/\.ds-hero \.json · builds on Draw Steel/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Forge Steel/ }))
    expect(screen.getByText('Forge Steel by Andy Aiken')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://forgesteel.net' })).toHaveAttribute(
      'href',
      'https://forgesteel.net'
    )
    expect(
      screen.getByText(/links · installs the pathfinder-2e sheet on first use/)
    ).toBeInTheDocument()
  })

  it('says what to do when no importers are installed', async () => {
    mockListImporters.mockResolvedValue({ importers: [] })
    renderDialog()
    expect(await screen.findByText(/None installed yet/)).toBeInTheDocument()
  })

  it('treats a failed listing as no importers', async () => {
    mockListImporters.mockRejectedValue(new Error('nope'))
    renderDialog()
    expect(await screen.findByText(/None installed yet/)).toBeInTheDocument()
  })

  it('sends a Grimoire export to the native import', async () => {
    mockImport.mockResolvedValue({ id: 'native' })
    const { onImported } = renderDialog()
    await screen.findByRole('option', { name: 'Forge Steel' })
    await userEvent.upload(
      screen.getByLabelText('Choose a file'),
      fileOf('{"schema_id":"dnd-5e","data":{}}', 'c.json')
    )
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ id: 'native' }))
    expect(mockImport).toHaveBeenCalledWith({ schema_id: 'dnd-5e', data: {} })
    expect(mockImportExternal).not.toHaveBeenCalled()
  })

  it('sends anything else to the importers, recognised automatically', async () => {
    mockImportExternal.mockResolvedValue({ id: 'hero' })
    const { onImported } = renderDialog()
    await screen.findByRole('option', { name: 'Forge Steel' })
    await userEvent.upload(screen.getByLabelText('Choose a file'), fileOf('{"class":{}}'))
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ id: 'hero' }))
    expect(mockImportExternal).toHaveBeenCalledWith({
      text: '{"class":{}}',
      filename: 'hero.ds-hero',
    })
  })

  it('names the chosen importer', async () => {
    mockImportExternal.mockResolvedValue({ id: 'hero' })
    renderDialog()
    await screen.findByRole('option', { name: 'Forge Steel' })
    await userEvent.selectOptions(screen.getByLabelText('Read it as'), 'forge-steel')
    await userEvent.upload(screen.getByLabelText('Choose a file'), fileOf('x', 'renamed.txt'))
    await waitFor(() =>
      expect(mockImportExternal).toHaveBeenCalledWith({
        text: 'x',
        filename: 'renamed.txt',
        importer_id: 'forge-steel',
      })
    )
  })

  it('reads a file as a Grimoire export when told to', async () => {
    renderDialog()
    await screen.findByRole('option', { name: 'Forge Steel' })
    await userEvent.selectOptions(screen.getByLabelText('Read it as'), 'grimoire')
    await userEvent.upload(screen.getByLabelText('Choose a file'), fileOf('not json'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/)
    expect(mockImport).not.toHaveBeenCalled()
  })

  it('shows what the server says, and lets the user try again', async () => {
    mockImportExternal.mockRejectedValueOnce(
      new Error('Several importers recognise this (A, B) - choose one and try again')
    )
    const { onImported } = renderDialog()
    await screen.findByRole('option', { name: 'Forge Steel' })
    await userEvent.upload(screen.getByLabelText('Choose a file'), fileOf('{}'))
    expect(await screen.findByRole('alert')).toHaveTextContent('choose one')
    expect(onImported).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument()
  })

  it('refuses a file over the size limit before reading it', async () => {
    renderDialog()
    await screen.findByRole('option', { name: 'Forge Steel' })
    await userEvent.upload(
      screen.getByLabelText('Choose a file'),
      fileOf('{}', 'big.json', 11 * 1024 * 1024)
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/too large/)
    expect(mockImportExternal).not.toHaveBeenCalled()
  })

  it('takes a dropped file', async () => {
    mockImportExternal.mockResolvedValue({ id: 'dropped' })
    const { onImported } = renderDialog()
    await screen.findByRole('option', { name: 'Forge Steel' })
    const zone = screen.getByTestId('import-drop-zone')
    fireEvent.dragOver(zone)
    fireEvent.dragLeave(zone)
    fireEvent.drop(zone, { dataTransfer: { files: [fileOf('{"a":1}')] } })
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ id: 'dropped' }))
  })

  it('offers a link only when an importer reads links', async () => {
    renderDialog()
    await screen.findByRole('option', { name: 'Forge Steel' })
    expect(screen.queryByLabelText('Or paste a link')).toBeNull()
  })

  it('imports a link', async () => {
    mockListImporters.mockResolvedValue({ importers: [FORGE, LINKED] })
    mockImportExternal.mockResolvedValue({ id: 'linked-hero' })
    const { onImported } = renderDialog()
    const input = await screen.findByLabelText('Or paste a link')
    expect(input).toHaveAttribute('placeholder', 'https://builder.test/c/123')
    const button = screen.getByRole('button', { name: 'Import link' })
    expect(button).toBeDisabled()
    await userEvent.type(input, 'https://builder.test/c/9')
    await userEvent.click(button)
    await waitFor(() => expect(onImported).toHaveBeenCalledWith({ id: 'linked-hero' }))
    expect(mockImportExternal).toHaveBeenCalledWith({ url: 'https://builder.test/c/9' })
  })

  it('a link goes to the chosen importer, and hides when it reads none', async () => {
    mockListImporters.mockResolvedValue({ importers: [FORGE, LINKED] })
    mockImportExternal.mockResolvedValue({ id: 'x' })
    renderDialog()
    await screen.findByLabelText('Or paste a link')
    await userEvent.selectOptions(screen.getByLabelText('Read it as'), 'forge-steel')
    expect(screen.queryByLabelText('Or paste a link')).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('Read it as'), 'linked')
    await userEvent.type(screen.getByLabelText('Or paste a link'), 'https://builder.test/c/1')
    await userEvent.click(screen.getByRole('button', { name: 'Import link' }))
    await waitFor(() =>
      expect(mockImportExternal).toHaveBeenCalledWith({
        url: 'https://builder.test/c/1',
        importer_id: 'linked',
      })
    )
  })

  describe('inputs', () => {
    const KEYED = {
      ...LINKED,
      id: 'keyed',
      name: 'Keyed Builder',
      inputs: [
        {
          key: 'api_key',
          label: 'API key',
          help: 'From your account page.',
          secret: true,
          required: false,
          when: 'link',
        },
        { key: 'note', label: 'Note', help: '', secret: false, required: true, when: 'file' },
      ],
    }
    const askingForKey = () =>
      Object.assign(new Error('Keyed Builder: this character is private'), {
        status: 400,
        body: {
          detail: {
            message: 'Keyed Builder: this character is private',
            importer_id: 'keyed',
            needs_input: ['api_key'],
          },
        },
      })

    beforeEach(() => {
      mockListImporters.mockResolvedValue({ importers: [FORGE, KEYED] })
    })

    it("shows the chosen importer's inputs, a secret one masked", async () => {
      renderDialog()
      await screen.findByRole('option', { name: 'Keyed Builder' })
      expect(screen.queryByLabelText('API key')).toBeNull()
      await userEvent.selectOptions(screen.getByLabelText('Read it as'), 'keyed')
      const key = screen.getByLabelText('API key')
      expect(key).toHaveAttribute('type', 'password')
      expect(screen.getByLabelText('Note *')).toHaveAttribute('type', 'text')
      expect(
        screen.getByText('From your account page. Used when importing a link.')
      ).toBeInTheDocument()
      expect(screen.getByText('Used when importing a file.')).toBeInTheDocument()
      expect(screen.getByText(/does not keep it/)).toBeInTheDocument()
    })

    it('sends what was typed, trimmed, and leaves out blanks', async () => {
      mockImportExternal.mockResolvedValue({ id: 'x' })
      renderDialog()
      await screen.findByRole('option', { name: 'Keyed Builder' })
      await userEvent.selectOptions(screen.getByLabelText('Read it as'), 'keyed')
      await userEvent.type(screen.getByLabelText('API key'), '  k-123 ')
      await userEvent.type(screen.getByLabelText('Or paste a link'), 'https://builder.test/c/1')
      await userEvent.click(screen.getByRole('button', { name: 'Import link' }))
      await waitFor(() =>
        expect(mockImportExternal).toHaveBeenCalledWith({
          url: 'https://builder.test/c/1',
          importer_id: 'keyed',
          inputs: { api_key: 'k-123' },
        })
      )
    })

    it('asks for what the importer needs and tries the same link again', async () => {
      mockImportExternal.mockRejectedValueOnce(askingForKey()).mockResolvedValueOnce({ id: 'ok' })
      const { onImported } = renderDialog()
      await userEvent.type(
        await screen.findByLabelText('Or paste a link'),
        'https://builder.test/c/9'
      )
      await userEvent.click(screen.getByRole('button', { name: 'Import link' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('this character is private')
      // The importer is chosen for the user and its field marked.
      expect(screen.getByLabelText('Read it as')).toHaveValue('keyed')
      const key = screen.getByLabelText('API key')
      expect(key).toHaveAttribute('aria-invalid', 'true')

      await userEvent.type(key, 'k-9')
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(onImported).toHaveBeenCalledWith({ id: 'ok' }))
      expect(mockImportExternal).toHaveBeenLastCalledWith({
        url: 'https://builder.test/c/9',
        importer_id: 'keyed',
        inputs: { api_key: 'k-9' },
      })
    })

    it('tries the same file again too', async () => {
      mockImportExternal
        .mockRejectedValueOnce(
          Object.assign(new Error('Keyed Builder: fill in Note'), {
            body: { detail: { importer_id: 'keyed', needs_input: ['note'] } },
          })
        )
        .mockResolvedValueOnce({ id: 'ok' })
      renderDialog()
      await screen.findByRole('option', { name: 'Keyed Builder' })
      await userEvent.upload(screen.getByLabelText('Choose a file'), fileOf('{"a":1}', 'h.kb'))
      await userEvent.type(await screen.findByLabelText('Note *'), 'hello')
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() =>
        expect(mockImportExternal).toHaveBeenLastCalledWith({
          text: '{"a":1}',
          filename: 'h.kb',
          importer_id: 'keyed',
          inputs: { note: 'hello' },
        })
      )
    })
  })

  it('reloads the list after installing an importer', async () => {
    mockListImporters
      .mockResolvedValueOnce({
        importers: [],
        available: [
          {
            id: 'forge-steel',
            name: 'Forge Steel',
            version: '1.0.0',
            sheet: 'draw-steel',
            install_as: 'user',
          },
        ],
      })
      .mockResolvedValueOnce({ importers: [FORGE], available: [] })
    mockInstallImporter.mockResolvedValue({ id: 'forge-steel' })
    renderDialog()
    await userEvent.click(await screen.findByRole('button', { name: 'Install' }))
    expect(await screen.findByRole('option', { name: 'Forge Steel' })).toBeInTheDocument()
    expect(mockListImporters).toHaveBeenCalledTimes(2)
  })

  it('closes', async () => {
    const { onClose } = renderDialog()
    await screen.findByRole('option', { name: 'Forge Steel' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})
