import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import AddToSoundboardButton from './AddToSoundboardButton'
import SoundboardLauncher from './SoundboardLauncher'
import { SoundboardProvider, useSoundboard } from '../../context/SoundboardContext'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

vi.mock('../../api', () => ({
  default: { get: vi.fn(() => Promise.resolve({})) },
  mediaUrl: (path) => `http://test${path}`,
}))

let board
function Probe() {
  board = useSoundboard()
  return <span data-testid="pads">{board.pads.map((p) => p.id).join(',')}</span>
}

const withProvider = (ui) =>
  render(
    <SoundboardProvider>
      {ui}
      <Probe />
    </SoundboardProvider>
  )

describe('AddToSoundboardButton', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('adds the track to the board', async () => {
    const user = userEvent.setup()
    withProvider(<AddToSoundboardButton track={{ id: 'a', title: 'Thunder' }} />)

    await user.click(screen.getByRole('button', { name: 'soundboard.add' }))
    expect(screen.getByTestId('pads')).toHaveTextContent('a')
    expect(board.pads[0].title).toBe('Thunder')
  })

  it('shows an added state and does not add twice', async () => {
    const user = userEvent.setup()
    withProvider(<AddToSoundboardButton track={{ id: 'a', title: 'Thunder' }} />)

    await user.click(screen.getByRole('button', { name: 'soundboard.add' }))
    const added = screen.getByRole('button', { name: 'soundboard.added' })
    expect(added).toHaveAttribute('aria-pressed', 'true')

    await user.click(added)
    expect(board.pads).toHaveLength(1)
  })

  it('renders nothing without a usable track', () => {
    const { container } = withProvider(<AddToSoundboardButton track={null} />)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('does not let the click reach an enclosing card', async () => {
    const user = userEvent.setup()
    const onCardClick = vi.fn()
    render(
      <SoundboardProvider>
        <div onClick={onCardClick}>
          <AddToSoundboardButton track={{ id: 'a', title: 'Thunder' }} />
        </div>
      </SoundboardProvider>
    )
    await user.click(screen.getByRole('button', { name: 'soundboard.add' }))
    expect(onCardClick).not.toHaveBeenCalled()
  })
})

describe('SoundboardLauncher', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stays hidden while the board is empty', () => {
    withProvider(<SoundboardLauncher />)
    expect(screen.queryByRole('button', { name: 'soundboard.open' })).toBeNull()
  })

  it('appears once a sound is added and the panel is closed', async () => {
    const user = userEvent.setup()
    withProvider(
      <>
        <AddToSoundboardButton track={{ id: 'a', title: 'Thunder' }} />
        <SoundboardLauncher />
      </>
    )
    // Adding opens the panel, so the launcher is hidden until it is closed.
    await user.click(screen.getByRole('button', { name: 'soundboard.add' }))
    expect(screen.queryByRole('button', { name: 'soundboard.open' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'soundboard.added' }))
    expect(board.open).toBe(true)
  })

  it('reopens the panel when clicked', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'grimoire:soundboard:pads',
      JSON.stringify([{ id: 'a', title: 'Thunder' }])
    )
    withProvider(<SoundboardLauncher />)

    await user.click(screen.getByRole('button', { name: 'soundboard.open' }))
    expect(board.open).toBe(true)
  })
})
