import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../api', () => ({
  campaigns: { list: vi.fn(), get: vi.fn() },
}))

import { campaigns } from '../../../api'
import SetAsArtDialog from './SetAsArtDialog'

const ME = 'user-me'

beforeEach(() => vi.clearAllMocks())

describe('SetAsArtDialog', () => {
  it('offers only the viewer’s own membership in a campaign they do not own', async () => {
    campaigns.list.mockResolvedValue({ campaigns: [{ id: 'c1' }] })
    campaigns.get.mockResolvedValue({
      id: 'c1',
      name: 'Curse of Strahd',
      owner_id: 'someone-else',
      members: [
        { id: 'm-me', user_id: ME, character_name: 'Ireena' },
        { id: 'm-other', user_id: 'user-other', character_name: 'Rictavio' },
      ],
    })

    render(<SetAsArtDialog userId={ME} onClose={vi.fn()} onChoose={vi.fn()} />)

    expect(await screen.findByText('Ireena')).toBeInTheDocument()
    expect(screen.queryByText('Rictavio')).not.toBeInTheDocument()
  })

  it('offers every membership in a campaign the viewer owns', async () => {
    campaigns.list.mockResolvedValue({ campaigns: [{ id: 'c1' }] })
    campaigns.get.mockResolvedValue({
      id: 'c1',
      name: 'My Game',
      owner_id: ME,
      members: [
        { id: 'm1', user_id: 'a', character_name: 'Alice' },
        { id: 'm2', user_id: 'b', character_name: 'Bob' },
      ],
    })

    render(<SetAsArtDialog userId={ME} onClose={vi.fn()} onChoose={vi.fn()} />)

    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('skips the synthetic owner row, which has no membership id', async () => {
    campaigns.list.mockResolvedValue({ campaigns: [{ id: 'c1' }] })
    campaigns.get.mockResolvedValue({
      id: 'c1',
      name: 'My Game',
      owner_id: ME,
      members: [
        { user_id: ME, username: 'gm', is_owner: true },
        { id: 'm1', user_id: 'a', character_name: 'Alice' },
      ],
    })

    render(<SetAsArtDialog userId={ME} onClose={vi.fn()} onChoose={vi.fn()} />)

    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('gm')).not.toBeInTheDocument()
  })

  it('falls back through character name, display name, then username', async () => {
    campaigns.list.mockResolvedValue({ campaigns: [{ id: 'c1' }] })
    campaigns.get.mockResolvedValue({
      id: 'c1',
      name: 'Game',
      owner_id: ME,
      members: [{ id: 'm1', user_id: 'a', display_name: null, username: 'plainuser' }],
    })

    render(<SetAsArtDialog userId={ME} onClose={vi.fn()} onChoose={vi.fn()} />)
    expect(await screen.findByText('plainuser')).toBeInTheDocument()
  })

  it('reports the chosen character back to the caller', async () => {
    campaigns.list.mockResolvedValue({ campaigns: [{ id: 'c1' }] })
    campaigns.get.mockResolvedValue({
      id: 'c1',
      name: 'Game',
      owner_id: ME,
      members: [{ id: 'm1', user_id: 'a', character_name: 'Alice' }],
    })
    const onChoose = vi.fn()

    render(<SetAsArtDialog userId={ME} onClose={vi.fn()} onChoose={onChoose} />)
    await userEvent.click(await screen.findByText('Alice'))

    expect(onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'c1', memberId: 'm1', memberName: 'Alice' })
    )
  })

  it('says so when there is nowhere to put the token', async () => {
    campaigns.list.mockResolvedValue({ campaigns: [] })
    render(<SetAsArtDialog userId={ME} onClose={vi.fn()} onChoose={vi.fn()} />)
    expect(
      await screen.findByText('You have no characters to set art for yet.')
    ).toBeInTheDocument()
  })

  it('surfaces a failure to load campaigns', async () => {
    campaigns.list.mockRejectedValue(new Error('offline'))
    render(<SetAsArtDialog userId={ME} onClose={vi.fn()} onChoose={vi.fn()} />)
    expect(await screen.findByText('offline')).toBeInTheDocument()
  })

  it('closes on the cancel button, the backdrop, and Escape', async () => {
    campaigns.list.mockResolvedValue({ campaigns: [] })
    const onClose = vi.fn()
    const { container } = render(
      <SetAsArtDialog userId={ME} onClose={onClose} onChoose={vi.fn()} />
    )
    await waitFor(() => expect(campaigns.list).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await userEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('is a labelled modal dialog', async () => {
    campaigns.list.mockResolvedValue({ campaigns: [] })
    render(<SetAsArtDialog userId={ME} onClose={vi.fn()} onChoose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })
})
