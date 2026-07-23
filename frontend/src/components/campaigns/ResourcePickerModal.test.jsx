import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResourcePickerModal from './ResourcePickerModal'
import { campaigns } from '../../api'

vi.mock('../../api', () => ({
  campaigns: { bulkAddResources: vi.fn() },
}))

// Stand-in picker: exposes a button that selects one book, and echoes the
// pinSystem / excludeKeys it was handed so the modal's wiring is verified.
vi.mock('./ResourcePicker', () => ({
  default: ({ selected, setSelected, pinSystem, systemId, excludeKeys }) => (
    <div data-testid="picker">
      <span>{`pin:${pinSystem}`}</span>
      <span>{`sys:${systemId ?? ''}`}</span>
      <span>{`excluded:${[...(excludeKeys || [])].join(',')}`}</span>
      <span>{`count:${selected.length}`}</span>
      <button
        onClick={() =>
          setSelected([
            { resource_type: 'book', resource_id: 'b1', name: 'PHB', visibility: 'public' },
          ])
        }
      >
        select-one
      </button>
    </div>
  ),
}))

beforeEach(() => vi.clearAllMocks())

describe('ResourcePickerModal', () => {
  it('pins the campaign system and passes linked keys, without a system filter', () => {
    render(
      <ResourcePickerModal
        campaignId="c1"
        pinSystem="D&D 5e"
        linkedKeys={new Set(['book:b9'])}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />
    )
    expect(screen.getByText('pin:D&D 5e')).toBeInTheDocument()
    // Linking browses every system, so no systemId filter is passed down.
    expect(screen.getByText('sys:')).toBeInTheDocument()
    expect(screen.getByText('excluded:book:b9')).toBeInTheDocument()
  })

  it('disables Add until something is selected', async () => {
    render(
      <ResourcePickerModal
        campaignId="c1"
        linkedKeys={new Set()}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />
    )
    const add = screen.getByRole('button', { name: /add/i })
    expect(add).toBeDisabled()
    await userEvent.click(screen.getByText('select-one'))
    expect(screen.getByRole('button', { name: /add/i })).toBeEnabled()
  })

  it('bulk-adds the selection and reports the additions', async () => {
    const added = [{ id: 'r1' }]
    campaigns.bulkAddResources.mockResolvedValue(added)
    const onAdded = vi.fn()
    render(
      <ResourcePickerModal
        campaignId="c1"
        linkedKeys={new Set()}
        onClose={vi.fn()}
        onAdded={onAdded}
      />
    )
    await userEvent.click(screen.getByText('select-one'))
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    await waitFor(() =>
      expect(campaigns.bulkAddResources).toHaveBeenCalledWith('c1', [
        { resource_type: 'book', resource_id: 'b1', visibility: 'public' },
      ])
    )
    expect(onAdded).toHaveBeenCalledWith(added)
  })

  it('surfaces an error and stays open when the add fails', async () => {
    campaigns.bulkAddResources.mockRejectedValue(new Error('boom'))
    const onAdded = vi.fn()
    render(
      <ResourcePickerModal
        campaignId="c1"
        linkedKeys={new Set()}
        onClose={vi.fn()}
        onAdded={onAdded}
      />
    )
    await userEvent.click(screen.getByText('select-one'))
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('closes via the close button', async () => {
    const onClose = vi.fn()
    render(
      <ResourcePickerModal
        campaignId="c1"
        linkedKeys={new Set()}
        onClose={onClose}
        onAdded={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
