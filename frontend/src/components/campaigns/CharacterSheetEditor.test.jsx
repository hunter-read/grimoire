import { describe, it, expect, vi, beforeEach } from 'vitest'
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

describe('CharacterSheetEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders fields from the API and saves edited values', async () => {
    campaigns.getMemberSheetFields.mockResolvedValue({
      fillable: true,
      fields: [{ name: 'name', type: 'text', value: 'Bob' }],
    })
    campaigns.saveMemberSheetFields.mockResolvedValue({ fillable: true, fields: [] })
    const onSaved = vi.fn()
    const onClose = vi.fn()

    render(
      <CharacterSheetEditor campaignId="c1" memberId="m1" onClose={onClose} onSaved={onSaved} />
    )

    const input = await screen.findByDisplayValue('Bob')
    fireEvent.change(input, { target: { value: 'Frodo' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(campaigns.saveMemberSheetFields).toHaveBeenCalledWith('c1', 'm1', { name: 'Frodo' })
    })
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a not-fillable message and hides Save when no form fields', async () => {
    campaigns.getMemberSheetFields.mockResolvedValue({ fillable: false, fields: [] })

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
    campaigns.listSheetSources.mockResolvedValue({
      books: [{ id: 'b1', name: 'Blank 5e Sheet' }],
      files: [],
    })
    campaigns.duplicateMemberSheet.mockResolvedValue({})
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
