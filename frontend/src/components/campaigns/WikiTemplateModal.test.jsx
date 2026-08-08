import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WikiTemplateModal from './WikiTemplateModal'

vi.mock('../../api', () => ({
  campaigns: {
    wikiTemplates: vi.fn(),
    getWikiTemplate: vi.fn(),
    createWikiTemplate: vi.fn(),
    updateWikiTemplate: vi.fn(),
    deleteWikiTemplate: vi.fn(),
    uploadWikiTemplate: vi.fn(),
    exportWikiTemplate: vi.fn(),
    useWikiTemplate: vi.fn(),
    browseWikiTemplates: vi.fn(),
    downloadWikiTemplate: vi.fn(),
    setWikiTemplateSource: vi.fn(),
  },
}))

import { campaigns } from '../../api'

const SPELL = {
  id: 't1',
  name: 'Spell',
  system: 'D&D 5e',
  category: 'Spells',
  description: 'A 5e spell.',
  source_id: '5e-spell',
}
const NPC = {
  id: 't2',
  name: 'NPC',
  system: 'D&D 5e',
  category: 'Characters',
  description: 'An NPC.',
  source_id: null,
}

const CATALOGUE = {
  folders: [
    {
      path: 'generic',
      name: 'Generic',
      templates: [
        {
          id: 'session-recap',
          name: 'Session Recap',
          category: 'Sessions',
          description: 'A recap.',
        },
      ],
    },
    {
      path: 'dnd-5e',
      name: 'Dungeons & Dragons 5e',
      templates: [
        {
          id: '5e-spell',
          name: 'Spell',
          system: 'D&D 5e',
          category: 'Spells',
          description: 'A spell.',
        },
      ],
    },
  ],
  downloaded_ids: [],
  index_url: 'https://raw.githubusercontent.com/x/main/templates/index.json',
  is_custom_url: false,
}

function renderModal(props = {}) {
  return render(<WikiTemplateModal campaignId="c1" onClose={vi.fn()} onUsed={vi.fn()} {...props} />)
}

describe('WikiTemplateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.wikiTemplates.mockResolvedValue({
      templates: [SPELL, NPC],
      campaign_system: 'D&D 5e',
      downloads_enabled: true,
    })
    campaigns.browseWikiTemplates.mockResolvedValue(CATALOGUE)
  })

  it('lists the campaign templates grouped by category', async () => {
    renderModal()
    await waitFor(() => expect(screen.getByText('Spells')).toBeTruthy())
    expect(screen.getByText('Characters')).toBeTruthy()
    expect(screen.getByText('A 5e spell.')).toBeTruthy()
  })

  it('shows an empty state when the campaign has no templates', async () => {
    campaigns.wikiTemplates.mockResolvedValue({
      templates: [],
      campaign_system: '',
      downloads_enabled: true,
    })
    renderModal()
    await waitFor(() => expect(screen.getByText(/No templates yet/)).toBeTruthy())
  })

  it('hands the template content up as an unsaved draft, creating nothing', async () => {
    campaigns.getWikiTemplate.mockResolvedValue({
      ...SPELL,
      body: '*2nd-level transmutation*',
      defaults: { title: 'New Spell', icon: 'sparkles', icon_color: 'blue', visibility: 'group' },
    })
    const onUsed = vi.fn()
    renderModal({ onUsed })

    fireEvent.click(await screen.findByText('A 5e spell.'))

    await waitFor(() =>
      expect(onUsed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Spell',
          body: '*2nd-level transmutation*',
          visibility: 'group',
          icon: 'sparkles',
          icon_color: 'blue',
        })
      )
    )
    // The draft carries no id, so PageEditor treats it as a new page — nothing
    // is written until the GM saves.
    expect(onUsed.mock.calls[0][0].id).toBeUndefined()
    expect(campaigns.useWikiTemplate).not.toHaveBeenCalled()
  })

  it('falls back to the template name when it declares no starting title', async () => {
    campaigns.getWikiTemplate.mockResolvedValue({ ...SPELL, body: 'x', defaults: {} })
    const onUsed = vi.fn()
    renderModal({ onUsed })
    fireEvent.click(await screen.findByText('A 5e spell.'))
    await waitFor(() =>
      expect(onUsed).toHaveBeenCalledWith(expect.objectContaining({ title: 'Spell' }))
    )
  })

  it('surfaces an error when the template cannot be read', async () => {
    campaigns.getWikiTemplate.mockRejectedValue(new Error('Template not found'))
    renderModal()
    fireEvent.click(await screen.findByText('A 5e spell.'))
    await waitFor(() => expect(screen.getByText('Template not found')).toBeTruthy())
  })

  it('deletes a template after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    campaigns.deleteWikiTemplate.mockResolvedValue({})
    renderModal()
    fireEvent.click(await screen.findByLabelText('Delete Spell'))
    await waitFor(() => expect(campaigns.deleteWikiTemplate).toHaveBeenCalledWith('c1', 't1'))
  })

  it('does not delete when the confirmation is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderModal()
    fireEvent.click(await screen.findByLabelText('Delete Spell'))
    expect(campaigns.deleteWikiTemplate).not.toHaveBeenCalled()
  })

  it('exports a template using its community id for the filename', async () => {
    campaigns.exportWikiTemplate.mockResolvedValue({})
    renderModal()
    fireEvent.click(await screen.findByLabelText('Export as a folder Spell'))
    await waitFor(() =>
      expect(campaigns.exportWikiTemplate).toHaveBeenCalledWith('c1', 't1', '5e-spell')
    )
  })

  it('falls back to the name when exporting an authored template', async () => {
    campaigns.exportWikiTemplate.mockResolvedValue({})
    renderModal()
    fireEvent.click(await screen.findByLabelText('Export as a folder NPC'))
    await waitFor(() =>
      expect(campaigns.exportWikiTemplate).toHaveBeenCalledWith('c1', 't2', 'NPC')
    )
  })

  it('uploads a markdown template and returns to the list', async () => {
    campaigns.uploadWikiTemplate.mockResolvedValue({ id: 't3' })
    const { container } = renderModal()
    await screen.findByText('Spells')

    const file = new File(['# Hi'], 'notes.md', { type: 'text/markdown' })
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [file] },
    })
    await waitFor(() => expect(campaigns.uploadWikiTemplate).toHaveBeenCalledWith('c1', file))
  })

  it('accepts a template .zip as well as markdown', async () => {
    campaigns.uploadWikiTemplate.mockResolvedValue({ id: 't4' })
    const { container } = renderModal()
    await screen.findByText('Spells')

    const picker = container.querySelector('input[type="file"]')
    // The export format is a .zip, so upload has to take one back.
    expect(picker.getAttribute('accept')).toContain('.zip')

    const zip = new File(['PK'], 'spell.zip', { type: 'application/zip' })
    fireEvent.change(picker, { target: { files: [zip] } })
    await waitFor(() => expect(campaigns.uploadWikiTemplate).toHaveBeenCalledWith('c1', zip))
  })

  it('hides the browse tab when downloading is disabled', async () => {
    campaigns.wikiTemplates.mockResolvedValue({
      templates: [SPELL],
      campaign_system: '',
      downloads_enabled: false,
    })
    renderModal()
    await screen.findByText('Spells')
    expect(screen.queryByRole('button', { name: 'Browse' })).toBeNull()
    // Authoring stays available — that's the documented escape hatch.
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy()
  })

  it('closes on the close button and on a backdrop click', async () => {
    const onClose = vi.fn()
    const { container } = renderModal({ onClose })
    await screen.findByText('Spells')

    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('WikiTemplateModal — browse tab', () => {
  // Two tests here drive the "just downloaded" timer. Restoring real timers in
  // afterEach (rather than at the end of each test) means a failing assertion
  // can't leak fake timers into an unrelated test file.
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.wikiTemplates.mockResolvedValue({
      templates: [],
      campaign_system: 'D&D 5e',
      downloads_enabled: true,
    })
    campaigns.browseWikiTemplates.mockResolvedValue(CATALOGUE)
  })

  const openBrowse = async () => {
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Browse' }))
    await waitFor(() => expect(campaigns.browseWikiTemplates).toHaveBeenCalled())
  }

  it('renders folders collapsed, in catalogue order', async () => {
    await openBrowse()
    expect(await screen.findByText('Generic')).toBeTruthy()
    expect(screen.getByText('Dungeons & Dragons 5e')).toBeTruthy()
    // Generic is collapsed, so its template is not on screen...
    expect(screen.queryByText('A recap.')).toBeNull()
  })

  it('auto-expands the folder matching the campaign system', async () => {
    await openBrowse()
    // The 5e folder holds a template whose system matches, so it opens.
    expect(await screen.findByText('A spell.')).toBeTruthy()
  })

  it('expands and collapses a folder on click', async () => {
    await openBrowse()
    const generic = await screen.findByText('Generic')
    fireEvent.click(generic)
    expect(await screen.findByText('A recap.')).toBeTruthy()
    fireEvent.click(generic)
    await waitFor(() => expect(screen.queryByText('A recap.')).toBeNull())
  })

  it('downloads a template and confirms it, then settles into "download again"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    campaigns.downloadWikiTemplate.mockResolvedValue({ id: 't9' })
    await openBrowse()
    await screen.findByText('A spell.')

    fireEvent.click(screen.getByRole('button', { name: /Download/ }))
    await waitFor(() =>
      expect(campaigns.downloadWikiTemplate).toHaveBeenCalledWith('c1', '5e-spell')
    )
    // Success is stated outright, not just implied by a changed label.
    expect(await screen.findByRole('button', { name: /Added/ })).toBeTruthy()

    // It fades back to the resting state, which records that you hold it.
    await vi.advanceTimersByTimeAsync(3000)
    expect(await screen.findByRole('button', { name: /Download again/ })).toBeTruthy()
  })

  it('re-confirms when downloading a template already held', async () => {
    // Without this, clicking "Download again" would leave the row looking
    // exactly as it did before and give no sign anything happened.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    campaigns.browseWikiTemplates.mockResolvedValue({
      ...CATALOGUE,
      downloaded_ids: ['5e-spell'],
    })
    campaigns.downloadWikiTemplate.mockResolvedValue({ id: 't9' })
    await openBrowse()

    const button = await screen.findByRole('button', { name: /Download again/ })
    fireEvent.click(button)
    expect(await screen.findByRole('button', { name: /Added/ })).toBeTruthy()
  })

  it('surfaces an error when the catalogue is unreachable', async () => {
    campaigns.browseWikiTemplates.mockRejectedValue(new Error('source timed out'))
    await openBrowse()
    expect(await screen.findByText('source timed out')).toBeTruthy()
  })

  it('says which catalogue is in use', async () => {
    await openBrowse()
    expect(await screen.findByText('Using the community catalogue')).toBeTruthy()
  })

  it('keeps the catalogue URL behind a button, and can change it', async () => {
    campaigns.setWikiTemplateSource.mockResolvedValue({})
    await openBrowse()
    await screen.findByText('Using the community catalogue')
    // The field is hidden until asked for.
    expect(screen.queryByLabelText('Change the catalogue URL')).toBeInstanceOf(HTMLButtonElement)

    fireEvent.click(screen.getByLabelText('Change the catalogue URL'))
    const input = await screen.findByPlaceholderText(/templates\/index.json/)
    fireEvent.change(input, { target: { value: 'https://example.com/t.json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(campaigns.setWikiTemplateSource).toHaveBeenCalledWith(
        'c1',
        'https://example.com/t.json'
      )
    )
  })

  it('keeps the Save/Reset labels on one line beside the URL input', async () => {
    // The URL is long; without a shrinkable input and non-shrinking buttons the
    // buttons get squeezed until their labels wrap mid-word.
    await openBrowse()
    fireEvent.click(await screen.findByLabelText('Change the catalogue URL'))

    const input = await screen.findByPlaceholderText(/templates\/index.json/)
    // `flex: 1` serialises to the longhand.
    expect(input.style.flex).toBe('1 1 0%')
    expect(input.style.minWidth).toBe('0px')

    for (const name of ['Save', 'Reset']) {
      const button = screen.getByRole('button', { name })
      expect(button.style.flexShrink).toBe('0')
      expect(button.style.whiteSpace).toBe('nowrap')
    }
  })

  it('resets the catalogue URL to the default', async () => {
    campaigns.setWikiTemplateSource.mockResolvedValue({})
    await openBrowse()
    fireEvent.click(await screen.findByLabelText('Change the catalogue URL'))
    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(campaigns.setWikiTemplateSource).toHaveBeenCalledWith('c1', ''))
  })

  it('refreshes the catalogue on demand', async () => {
    await openBrowse()
    fireEvent.click(await screen.findByLabelText('Refresh the catalogue'))
    await waitFor(() => expect(campaigns.browseWikiTemplates).toHaveBeenCalledWith('c1', true))
  })

  it('reports an empty catalogue', async () => {
    campaigns.browseWikiTemplates.mockResolvedValue({ ...CATALOGUE, folders: [] })
    await openBrowse()
    expect(await screen.findByText('The catalogue has no templates.')).toBeTruthy()
  })
})

describe('WikiTemplateModal — create and edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.wikiTemplates.mockResolvedValue({
      templates: [SPELL],
      campaign_system: '',
      downloads_enabled: true,
      categories: ['Characters', 'Spells'],
    })
  })

  it("offers the server's categories in a dropdown", async () => {
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }))
    const select = await screen.findByLabelText('Category (optional)')
    const options = [...select.querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toContain('Characters')
    expect(options).toContain('Spells')
    expect(options).toContain('New category…')
  })

  it('lets a new category be typed and saves it', async () => {
    campaigns.createWikiTemplate.mockResolvedValue({ id: 't5' })
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Airship' } })

    fireEvent.change(screen.getByLabelText('Category (optional)'), {
      target: { value: '__new__' },
    })
    fireEvent.change(await screen.findByLabelText('New category…'), {
      target: { value: 'Airships' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Create template/ }))

    await waitFor(() =>
      expect(campaigns.createWikiTemplate).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ category: 'Airships' })
      )
    )
  })

  it('sends the page defaults, and never a game system', async () => {
    campaigns.createWikiTemplate.mockResolvedValue({ id: 't6' })
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'NPC' } })
    fireEvent.change(screen.getByLabelText('Starting page name'), {
      target: { value: 'New NPC' },
    })
    fireEvent.change(screen.getByLabelText('Page visibility'), { target: { value: 'group' } })
    fireEvent.click(screen.getByRole('button', { name: /Create template/ }))

    await waitFor(() => expect(campaigns.createWikiTemplate).toHaveBeenCalled())
    const payload = campaigns.createWikiTemplate.mock.calls[0][1]
    expect(payload.defaults).toMatchObject({ title: 'New NPC', visibility: 'group' })
    // Game system is meaningless for a hand-written template.
    expect(payload.system).toBeUndefined()
  })

  it("fills the form from a template's parsed defaults, hiding the frontmatter", async () => {
    campaigns.getWikiTemplate.mockResolvedValue({
      ...SPELL,
      body: '*2nd-level transmutation*',
      defaults: { title: 'New Spell', icon: 'sparkles', icon_color: '', visibility: 'group' },
    })
    renderModal()
    fireEvent.click(await screen.findByLabelText('Edit Spell'))

    // The defaults arrive as form values...
    expect(await screen.findByDisplayValue('New Spell')).toBeTruthy()
    expect(screen.getByLabelText('Page visibility').value).toBe('group')
    // ...and the body textarea shows no YAML.
    const body = screen.getByLabelText('Page content')
    expect(body.value).toBe('*2nd-level transmutation*')
    expect(body.value).not.toContain('---')
  })

  it('creates a template from the form', async () => {
    campaigns.createWikiTemplate.mockResolvedValue({ id: 't5' })
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }))

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Faction' } })
    fireEvent.change(screen.getByLabelText('Page content'), { target: { value: '# Faction' } })
    fireEvent.click(screen.getByRole('button', { name: /Create template/ }))

    await waitFor(() =>
      expect(campaigns.createWikiTemplate).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ name: 'Faction', body: '# Faction' })
      )
    )
  })

  it('refuses to save without a name', async () => {
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: /Create template/ }))

    expect(await screen.findByText('Give the template a name.')).toBeTruthy()
    expect(campaigns.createWikiTemplate).not.toHaveBeenCalled()
  })

  it('right-aligns the Create button', async () => {
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }))
    const button = await screen.findByRole('button', { name: /Create template/ })
    expect(button.style.alignSelf).toBe('flex-end')
  })

  it('right-aligns the Save button when editing', async () => {
    campaigns.getWikiTemplate.mockResolvedValue({ ...SPELL, body: '# Spell' })
    renderModal()
    fireEvent.click(await screen.findByLabelText('Edit Spell'))
    const button = await screen.findByRole('button', { name: /Save/ })
    expect(button.style.alignSelf).toBe('flex-end')
  })

  it('loads an existing template into the editor and saves it', async () => {
    campaigns.getWikiTemplate.mockResolvedValue({ ...SPELL, body: '# Spell' })
    campaigns.updateWikiTemplate.mockResolvedValue({})
    renderModal()

    fireEvent.click(await screen.findByLabelText('Edit Spell'))
    await waitFor(() => expect(campaigns.getWikiTemplate).toHaveBeenCalledWith('c1', 't1'))
    expect(await screen.findByDisplayValue('# Spell')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() =>
      expect(campaigns.updateWikiTemplate).toHaveBeenCalledWith(
        'c1',
        't1',
        expect.objectContaining({ name: 'Spell' })
      )
    )
  })

  it('surfaces an error when loading a template for editing fails', async () => {
    campaigns.getWikiTemplate.mockRejectedValue(new Error('Template not found'))
    renderModal()
    fireEvent.click(await screen.findByLabelText('Edit Spell'))
    expect(await screen.findByText('Template not found')).toBeTruthy()
  })

  it('surfaces a save failure and stays on the form', async () => {
    campaigns.createWikiTemplate.mockRejectedValue(new Error('Name cannot be empty'))
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: /Create template/ }))

    expect(await screen.findByText('Name cannot be empty')).toBeTruthy()
    expect(screen.getByLabelText('Name')).toBeTruthy()
  })
})
