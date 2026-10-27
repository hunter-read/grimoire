import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareLinkList from './ShareLinkList'
import { shareLinks, type Schema } from '../../api'

vi.mock('../../api', () => ({
  shareLinks: { revoke: vi.fn(), remove: vi.fn() },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en-US' } }),
}))

const link = (over: Partial<Schema<'ShareLinkOut'>> = {}): Schema<'ShareLinkOut'> => ({
  id: 'l1',
  resource_id: 'm1',
  url: 'u',
  file_url: 'f',
  resource_type: 'map',
  resource_name: 'Map',
  label: 'One',
  filename: 'one.png',
  has_password: false,
  state: 'active',
  use_count: 0,
  ...over,
})

beforeEach(() => vi.resetAllMocks())

describe('ShareLinkList', () => {
  it('shows the empty text', () => {
    render(<ShareLinkList links={[]} onChange={vi.fn()} emptyText="nothing here" />)
    expect(screen.getByText('nothing here')).toBeInTheDocument()
  })

  it('revokes and reports the updated list', async () => {
    vi.mocked(shareLinks.revoke).mockResolvedValue(link({ state: 'revoked' }))
    const onChange = vi.fn()
    render(<ShareLinkList links={[link()]} onChange={onChange} />)
    fireEvent.click(screen.getByText('share.row.revoke'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([link({ state: 'revoked' })]))
  })

  it('deletes and drops it from the list', async () => {
    vi.mocked(shareLinks.remove).mockResolvedValue({ status: 'deleted' })
    const onChange = vi.fn()
    render(<ShareLinkList links={[link({ state: 'revoked' })]} onChange={onChange} />)
    fireEvent.click(screen.getByText('share.row.delete'))
    fireEvent.click(screen.getByText('share.row.confirmDelete'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]))
  })

  it('reports failures', async () => {
    vi.mocked(shareLinks.revoke).mockRejectedValue(new Error('nope'))
    vi.mocked(shareLinks.remove).mockRejectedValue(new Error(''))
    const onError = vi.fn()
    render(
      <ShareLinkList
        links={[link(), link({ id: 'l2', state: 'revoked', label: 'Two' })]}
        onChange={vi.fn()}
        onError={onError}
      />
    )
    fireEvent.click(screen.getByText('share.row.revoke'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('nope'))
    fireEvent.click(screen.getByText('share.row.delete'))
    fireEvent.click(screen.getByText('share.row.confirmDelete'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('share.deleteFailed'))
  })
})
