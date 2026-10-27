import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CharacterSheetEditor from './CharacterSheetEditor'
import SheetTemplatePicker from './SheetTemplatePicker'

vi.mock('../../api', () => ({
  campaigns: {
    getMemberSheetFields: vi.fn(),
    saveMemberSheetFields: vi.fn(),
    listSheetSources: vi.fn(),
    duplicateMemberSheet: vi.fn(),
  },
}))

import { campaigns } from '../../api'

// The api module is mocked above; reach its helpers as plain vi.fn()s.
// The sheet-fields helpers are gone from the real api module (see the component).
const campaignsMock = campaigns as unknown as Record<
  keyof typeof campaigns | 'getMemberSheetFields' | 'saveMemberSheetFields',
  Mock
>

describe('CharacterSheetEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders fields from the API and saves edited values', async () => {
    campaignsMock.getMemberSheetFields.mockResolvedValue({
      fillable: true,
      fields: [{ name: 'name', type: 'text', value: 'Bob' }],
    })
    campaignsMock.saveMemberSheetFields.mockResolvedValue({ fillable: true, fields: [] })
    const onSaved = vi.fn()
    const onClose = vi.fn()

    render(
      <CharacterSheetEditor campaignId="c1" memberId="m1" onClose={onClose} onSaved={onSaved} />
    )

    const input = await screen.findByDisplayValue('Bob')
    fireEvent.change(input, { target: { value: 'Frodo' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(campaignsMock.saveMemberSheetFields).toHaveBeenCalledWith('c1', 'm1', {
        name: 'Frodo',
      })
    })
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a not-fillable message and hides Save when no form fields', async () => {
    campaignsMock.getMemberSheetFields.mockResolvedValue({ fillable: false, fields: [] })

    render(<CharacterSheetEditor campaignId="c1" memberId="m1" onClose={vi.fn()} />)

    await screen.findByText(/no fillable form fields/i)
    expect(screen.queryByText('Save')).toBeNull()
  })
})

describe('SheetTemplatePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('duplicates the chosen library template', async () => {
    campaignsMock.listSheetSources.mockResolvedValue({
      books: [{ id: 'b1', name: 'Blank 5e Sheet' }],
      files: [],
    })
    campaignsMock.duplicateMemberSheet.mockResolvedValue({})
    const onDuplicated = vi.fn()

    render(
      <SheetTemplatePicker
        campaignId="c1"
        memberId="m1"
        onClose={vi.fn()}
        onDuplicated={onDuplicated}
      />
    )

    fireEvent.click(await screen.findByText('Blank 5e Sheet'))

    await waitFor(() => {
      expect(campaigns.duplicateMemberSheet).toHaveBeenCalledWith('c1', 'm1', {
        source_type: 'book',
        source_id: 'b1',
      })
    })
    expect(onDuplicated).toHaveBeenCalled()
  })
})
