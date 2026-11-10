import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import CampaignMapCopiesNotice from './CampaignMapCopiesNotice'

vi.mock('../../api', () => ({
  files: { campaignMapCopies: vi.fn() },
}))

import { files } from '../../api'

const copies = (files as unknown as Record<string, Mock>).campaignMapCopies

beforeEach(() => copies.mockReset())

describe('CampaignMapCopiesNotice', () => {
  it('lists each campaign and what it keeps', async () => {
    copies.mockResolvedValue({
      campaigns: [
        {
          campaign_id: 'a',
          campaign_name: 'Saltmarsh',
          map_id: 'm1',
          map_name: 'x.png',
          outcome: 'copy',
        },
        {
          campaign_id: 'b',
          campaign_name: 'Rime',
          map_id: 'm1',
          map_name: 'x.png',
          outcome: 'too_large',
        },
        {
          campaign_id: 'c',
          campaign_name: 'Odd',
          map_id: 'm1',
          map_name: 'x.png',
          outcome: 'file_missing',
        },
      ],
    })
    render(<CampaignMapCopiesNotice path="maps/Coast/x.png" />)
    expect(await screen.findByText('Saltmarsh')).toBeInTheDocument()
    const notice = screen.getByTestId('campaign-map-copies')
    expect(notice).toHaveTextContent('Saltmarsh - keeps its own copy')
    expect(notice).toHaveTextContent('Rime - too large for its upload limits')
    expect(notice).toHaveTextContent('Odd - no copy can be kept')
    expect(copies).toHaveBeenCalledWith('maps/Coast/x.png')
  })

  it('names the map when several are going', async () => {
    copies.mockResolvedValue({
      campaigns: [
        {
          campaign_id: 'a',
          campaign_name: 'One',
          map_id: 'm1',
          map_name: 'a.png',
          outcome: 'copy',
        },
        {
          campaign_id: 'a',
          campaign_name: 'One',
          map_id: 'm2',
          map_name: 'b.png',
          outcome: 'not_image',
        },
      ],
    })
    render(<CampaignMapCopiesNotice path="maps/Coast" />)
    expect(await screen.findByText(/\(b\.png\)/)).toHaveTextContent('not an image map')
  })

  it('stays quiet outside the maps collection, and when nothing uses the map', async () => {
    const { container, rerender } = render(<CampaignMapCopiesNotice path="books/Core/x.pdf" />)
    expect(copies).not.toHaveBeenCalled()
    copies.mockResolvedValue({ campaigns: [] })
    rerender(<CampaignMapCopiesNotice path="maps/x.png" />)
    await Promise.resolve()
    expect(container).toBeEmptyDOMElement()
  })
})
