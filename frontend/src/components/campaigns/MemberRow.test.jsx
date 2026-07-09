import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MemberRow from './MemberRow'
import { campaigns } from '../../api'

vi.mock('../../api', () => ({
  campaigns: {
    memberArtUrl: vi.fn(() => '/api/art'),
    memberSheetUrl: vi.fn(() => '/api/sheet'),
    uploadMemberArt: vi.fn(),
    uploadMemberSheet: vi.fn(),
    deleteMemberSheet: vi.fn(),
    setCharacterSheetUrl: vi.fn(),
  },
}))

// The nested editor/picker/dialog components make their own API calls — stub
// them so these tests stay focused on MemberRow's own wiring.
vi.mock('./PdfSheetEditor', () => ({
  default: ({ onClose }) => (
    <div data-testid="sheet-editor">
      <button onClick={onClose}>close-editor</button>
    </div>
  ),
}))
vi.mock('./SheetTemplatePicker', () => ({
  default: ({ onClose }) => (
    <div data-testid="template-picker">
      <button onClick={onClose}>close-picker</button>
    </div>
  ),
}))
vi.mock('./ReplaceSheetDialog', () => ({
  default: ({ onReplace, onCancel }) => (
    <div data-testid="replace-dialog">
      <button onClick={onReplace}>confirm-replace</button>
      <button onClick={onCancel}>cancel-replace</button>
    </div>
  ),
}))

const baseMember = {
  id: 'm1',
  user_id: 'u1',
  username: 'alice',
  display_name: null,
  character_name: null,
  status: 'accepted',
  is_owner: false,
}

function renderRow(memberOverrides = {}, props = {}) {
  const member = { ...baseMember, ...memberOverrides }
  return render(
    <MemberRow
      member={member}
      isOwner={false}
      canManage={false}
      currentUserId="other"
      campaignId="c1"
      onRemove={vi.fn()}
      onUpdateStatus={vi.fn()}
      onSetCharacterName={vi.fn()}
      onMediaChanged={vi.fn()}
      {...props}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MemberRow character name editing', () => {
  it('lets a manager edit and save the character name', async () => {
    const onSetCharacterName = vi.fn().mockResolvedValue()
    renderRow({}, { canManage: true, onSetCharacterName })

    await userEvent.click(screen.getByLabelText('Edit character name'))
    const input = screen.getByLabelText('Character name')
    await userEvent.type(input, 'Vex  ')
    await userEvent.click(screen.getByText('Save'))

    expect(onSetCharacterName).toHaveBeenCalledWith('u1', 'Vex')
  })

  it('saves the character name on Enter', async () => {
    const onSetCharacterName = vi.fn().mockResolvedValue()
    renderRow({}, { canManage: true, onSetCharacterName })
    await userEvent.click(screen.getByLabelText('Edit character name'))
    await userEvent.type(screen.getByLabelText('Character name'), 'Nott{Enter}')
    expect(onSetCharacterName).toHaveBeenCalledWith('u1', 'Nott')
  })

  it('cancels editing on Escape without saving', async () => {
    const onSetCharacterName = vi.fn()
    renderRow({}, { canManage: true, onSetCharacterName })
    await userEvent.click(screen.getByLabelText('Edit character name'))
    await userEvent.type(screen.getByLabelText('Character name'), 'Nope{Escape}')
    expect(onSetCharacterName).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Character name')).not.toBeInTheDocument()
  })

  it('cancels editing via the Cancel button', async () => {
    renderRow({}, { canManage: true })
    await userEvent.click(screen.getByLabelText('Edit character name'))
    await userEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByLabelText('Character name')).not.toBeInTheDocument()
  })
})

describe('MemberRow art upload', () => {
  it('uploads character art and signals a media change', async () => {
    campaigns.uploadMemberArt.mockResolvedValue()
    const onMediaChanged = vi.fn()
    // isCurrentUser enables editing without canManage.
    renderRow({}, { currentUserId: 'u1', onMediaChanged })

    const file = new File(['x'], 'art.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"]')
    await waitFor(() => expect(input).toBeTruthy())
    await userEvent.upload(input, file)

    await waitFor(() => expect(campaigns.uploadMemberArt).toHaveBeenCalledWith('c1', 'm1', file))
    expect(onMediaChanged).toHaveBeenCalled()
  })

  it('alerts when art upload fails', async () => {
    campaigns.uploadMemberArt.mockRejectedValue(new Error('too big'))
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    renderRow({}, { currentUserId: 'u1' })

    const file = new File(['x'], 'art.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"]')
    await userEvent.upload(input, file)

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('too big'))
    alertSpy.mockRestore()
  })

  it('renders the existing art image when the member has art', () => {
    renderRow({ has_art: true }, { currentUserId: 'u1' })
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/api/art')
  })
})

describe('MemberRow sheet actions', () => {
  it('shows upload / template / link buttons when editable and no sheet exists', () => {
    renderRow({}, { currentUserId: 'u1' })
    expect(screen.getByText('Upload sheet')).toBeInTheDocument()
    expect(screen.getByText('Create from template')).toBeInTheDocument()
    expect(screen.getByText('Add link')).toBeInTheDocument()
  })

  it('uploads a sheet file', async () => {
    campaigns.uploadMemberSheet.mockResolvedValue()
    const onMediaChanged = vi.fn()
    renderRow({}, { currentUserId: 'u1', onMediaChanged })

    const file = new File(['%PDF'], 'sheet.pdf', { type: 'application/pdf' })
    const sheetInput = document.querySelector('input[accept*="application/pdf"]')
    await userEvent.upload(sheetInput, file)

    await waitFor(() => expect(campaigns.uploadMemberSheet).toHaveBeenCalledWith('c1', 'm1', file))
    expect(onMediaChanged).toHaveBeenCalled()
  })

  it('opens the template picker and can close it', async () => {
    renderRow({}, { currentUserId: 'u1' })
    await userEvent.click(screen.getByText('Create from template'))
    expect(screen.getByTestId('template-picker')).toBeInTheDocument()
    await userEvent.click(screen.getByText('close-picker'))
    expect(screen.queryByTestId('template-picker')).not.toBeInTheDocument()
  })

  it('links an external sheet URL', async () => {
    campaigns.setCharacterSheetUrl.mockResolvedValue()
    const onMediaChanged = vi.fn()
    renderRow({}, { currentUserId: 'u1', onMediaChanged })

    await userEvent.click(screen.getByText('Add link'))
    const input = screen.getByPlaceholderText('https://… sheet or PDF')
    await userEvent.type(input, 'https://sheet.example/abc')
    await userEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(campaigns.setCharacterSheetUrl).toHaveBeenCalledWith(
        'c1',
        'u1',
        'https://sheet.example/abc'
      )
    )
    expect(onMediaChanged).toHaveBeenCalled()
  })

  it('closes the link input without saving when URL is blank', async () => {
    renderRow({}, { currentUserId: 'u1' })
    await userEvent.click(screen.getByText('Add link'))
    await userEvent.click(screen.getByText('Save'))
    expect(campaigns.setCharacterSheetUrl).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('https://… sheet or PDF')).not.toBeInTheDocument()
  })

  it('renders a link to an existing external sheet', () => {
    renderRow({ character_sheet_url: 'https://sheet.example/abc' })
    const link = screen.getByRole('link', { name: /character sheet \(link\)/i })
    expect(link).toHaveAttribute('href', 'https://sheet.example/abc')
  })

  it('removes an uploaded sheet via the delete endpoint', async () => {
    campaigns.deleteMemberSheet.mockResolvedValue()
    const onMediaChanged = vi.fn()
    renderRow(
      { has_sheet: true, character_sheet_filename: 'char.pdf' },
      { currentUserId: 'u1', onMediaChanged }
    )
    await userEvent.click(screen.getByLabelText('Remove sheet'))
    await waitFor(() => expect(campaigns.deleteMemberSheet).toHaveBeenCalledWith('c1', 'm1'))
    expect(onMediaChanged).toHaveBeenCalled()
  })

  it('removing an external-link sheet clears the URL instead', async () => {
    campaigns.setCharacterSheetUrl.mockResolvedValue()
    renderRow({ character_sheet_url: 'https://sheet.example/abc' }, { currentUserId: 'u1' })
    await userEvent.click(screen.getByLabelText('Remove sheet'))
    await waitFor(() => expect(campaigns.setCharacterSheetUrl).toHaveBeenCalledWith('c1', 'u1', ''))
  })

  it('confirms before replacing an existing sheet', async () => {
    renderRow({ has_sheet: true, character_sheet_filename: 'char.pdf' }, { currentUserId: 'u1' })
    await userEvent.click(screen.getByLabelText('Replace sheet'))
    expect(screen.getByTestId('replace-dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByText('cancel-replace'))
    expect(screen.queryByTestId('replace-dialog')).not.toBeInTheDocument()
  })

  it('offers in-app editing for an uploaded PDF sheet', async () => {
    renderRow({ has_sheet: true, character_sheet_filename: 'char.pdf' }, { currentUserId: 'u1' })
    await userEvent.click(screen.getByText('Edit in app'))
    expect(screen.getByTestId('sheet-editor')).toBeInTheDocument()
  })
})

describe('MemberRow status and removal controls', () => {
  it('shows accept/decline for the current user when invited', async () => {
    const onUpdateStatus = vi.fn()
    renderRow({ status: 'invited' }, { currentUserId: 'u1', onUpdateStatus })
    await userEvent.click(screen.getByLabelText(/accept/i))
    expect(onUpdateStatus).toHaveBeenCalledWith('u1', 'accepted')
    await userEvent.click(screen.getByLabelText(/decline/i))
    expect(onUpdateStatus).toHaveBeenCalledWith('u1', 'declined')
  })

  it('lets a manager remove another member', async () => {
    const onRemove = vi.fn()
    renderRow({}, { canManage: true, onRemove })
    await userEvent.click(screen.getByLabelText(/remove alice/i))
    expect(onRemove).toHaveBeenCalledWith('u1')
  })

  it('renders the GM badge and no status pill for the owner row', () => {
    renderRow({ is_owner: true, character_name: 'The Dungeon Master' })
    expect(screen.getByText('The Dungeon Master')).toBeInTheDocument()
    // Owner row shows no status pill / remove button.
    expect(screen.queryByLabelText(/remove/i)).not.toBeInTheDocument()
  })
})
