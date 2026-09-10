import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

vi.mock('../../api', () => ({
  campaigns: { memberArtUrl: vi.fn((c, m, v) => `/api/art/${c}/${m}${v ? `?v=${v}` : ''}`) },
}))

vi.mock('../LazyImg', () => ({
  default: ({ src, alt }) => <img src={src} alt={alt} />,
}))

import { campaigns } from '../../api'
import MemberArtButton from './MemberArtButton'

const member = (overrides = {}) => ({
  id: 'm1',
  user_id: 'u1',
  character_name: 'Ireena',
  has_art: false,
  ...overrides,
})

const setup = (props = {}) => {
  const onUpload = vi.fn()
  render(
    <MemberArtButton
      member={member()}
      campaignId="c1"
      canEdit
      isMemberOwner={false}
      displayLabel="ireena"
      busy={false}
      onUpload={onUpload}
      {...props}
    />
  )
  return { onUpload }
}

beforeEach(() => vi.clearAllMocks())

describe('MemberArtButton', () => {
  it('offers both ways to set a portrait', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Set character art' }))
    expect(screen.getByRole('menuitem', { name: /Create\ a\ token…/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Upload\ character\ art/ })).toBeInTheDocument()
  })

  it('opens the editor pre-bound to this member', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Set character art' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Create\ a\ token…/ }))

    expect(navigate).toHaveBeenCalledWith('/tokens/editor', {
      state: { campaignId: 'c1', memberId: 'm1', memberName: 'Ireena' },
    })
  })

  it('falls back to the display label when there is no character name', async () => {
    setup({ member: member({ character_name: null }) })
    await userEvent.click(screen.getByRole('button', { name: 'Set character art' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Create\ a\ token…/ }))
    expect(navigate.mock.calls[0][1].state.memberName).toBe('ireena')
  })

  it('hands an uploaded file straight to the caller', async () => {
    const { onUpload } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Set character art' }))
    await userEvent.upload(
      screen.getByTestId('member-art-input'),
      new File(['x'], 'art.png', { type: 'image/png' })
    )
    expect(onUpload).toHaveBeenCalledWith(expect.any(File))
  })

  it('shows no menu and no file input to someone who may not edit', () => {
    setup({ canEdit: false })
    expect(screen.queryByRole('button', { name: 'Set character art' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('member-art-input')).not.toBeInTheDocument()
  })

  it('shows an initial when there is no art', () => {
    setup({ canEdit: false })
    expect(screen.getByText('I')).toBeInTheDocument()
  })

  it('renders existing art with the cache-busting version', () => {
    setup({ member: member({ has_art: true }), artVersion: 1234 })
    expect(campaigns.memberArtUrl).toHaveBeenCalledWith('c1', 'm1', 1234)
    expect(screen.getByAltText('Ireena')).toHaveAttribute('src', expect.stringContaining('v=1234'))
  })

  it('closes the menu when the backdrop is clicked', async () => {
    const { container } = render(
      <MemberArtButton
        member={member()}
        campaignId="c1"
        canEdit
        isMemberOwner={false}
        displayLabel="ireena"
        busy={false}
        onUpload={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Set character art' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    // The invisible full-screen dismisser sits directly before the menu.
    await userEvent.click(container.querySelector('div[style*="fixed"]'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('is disabled while an upload is in flight', () => {
    setup({ busy: true })
    expect(screen.getByRole('button', { name: 'Set character art' })).toBeDisabled()
  })
})
