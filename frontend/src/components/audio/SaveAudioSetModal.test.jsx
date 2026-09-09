import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import SaveAudioSetModal from './SaveAudioSetModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      if (opts?.name) return `${key}:${opts.name}`
      if (opts?.count !== undefined) return `${key}:${opts.count}`
      return key
    },
  }),
}))

const setup = (props = {}) => {
  const onSave = props.onSave || vi.fn(() => Promise.resolve({ id: 'new' }))
  const onClose = props.onClose || vi.fn()
  const user = userEvent.setup()
  render(
    <SaveAudioSetModal kind="playlist" count={3} onSave={onSave} onClose={onClose} {...props} />
  )
  return { user, onSave, onClose }
}

describe('SaveAudioSetModal', () => {
  it('names the queue and saves it', async () => {
    const { user, onSave, onClose } = setup()
    await user.type(screen.getByLabelText('audioSets.nameLabel'), 'Storm')
    await user.click(screen.getByRole('button', { name: 'common.save' }))
    expect(onSave).toHaveBeenCalledWith('Storm')
    expect(onClose).toHaveBeenCalled()
  })

  it('trims the name before saving', async () => {
    const { user, onSave } = setup()
    await user.type(screen.getByLabelText('audioSets.nameLabel'), '  Storm  ')
    await user.click(screen.getByRole('button', { name: 'common.save' }))
    expect(onSave).toHaveBeenCalledWith('Storm')
  })

  it('saves on Enter', async () => {
    const { user, onSave } = setup()
    await user.type(screen.getByLabelText('audioSets.nameLabel'), 'Storm{Enter}')
    expect(onSave).toHaveBeenCalledWith('Storm')
  })

  it('keeps save disabled until a name is typed', async () => {
    const { user, onSave } = setup()
    const save = screen.getByRole('button', { name: 'common.save' })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('audioSets.nameLabel'), 'x')
    expect(save).toBeEnabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('warns before overwriting an existing name, case-insensitively', async () => {
    const { user } = setup({ existing: ['Tavern'] })
    const input = screen.getByLabelText('audioSets.nameLabel')
    await user.type(input, 'Forest')
    expect(screen.queryByText(/audioSets.overwriteWarning/)).toBeNull()
    await user.clear(input)
    await user.type(input, 'tavern')
    expect(screen.getByText('audioSets.overwriteWarning:tavern')).toBeInTheDocument()
  })

  it('shows the count and the right title for a soundboard', () => {
    setup({ kind: 'soundboard', count: 5 })
    expect(screen.getByText('audioSets.saveBoard')).toBeInTheDocument()
    expect(screen.getByText('audioSets.saveBoardIntro:5')).toBeInTheDocument()
  })

  it('shows the playlist title and count by default', () => {
    setup()
    expect(screen.getByText('audioSets.savePlaylist')).toBeInTheDocument()
    expect(screen.getByText('audioSets.savePlaylistIntro:3')).toBeInTheDocument()
  })

  it('reports a rejected save and stays open', async () => {
    const onSave = vi.fn(() => Promise.reject(new Error('name taken')))
    const { user, onClose } = setup({ onSave })
    await user.type(screen.getByLabelText('audioSets.nameLabel'), 'Storm')
    await user.click(screen.getByRole('button', { name: 'common.save' }))
    expect(await screen.findByText('name taken')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports a save that resolves to nothing as a failure', async () => {
    const onSave = vi.fn(() => Promise.resolve(null))
    const { user, onClose } = setup({ onSave })
    await user.type(screen.getByLabelText('audioSets.nameLabel'), 'Storm')
    await user.click(screen.getByRole('button', { name: 'common.save' }))
    expect(await screen.findByText('audioSets.saveFailed')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes from the close button and the backdrop, but not the panel', async () => {
    const { user, onClose } = setup()
    await user.click(screen.getByRole('button', { name: 'common.close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)

    await user.click(screen.getByText('audioSets.savePlaylist'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('cancels without saving', async () => {
    const { user, onSave, onClose } = setup()
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
