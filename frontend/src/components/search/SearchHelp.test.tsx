import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchHelp from './SearchHelp'

function renderHelp(props = {}) {
  const onClose = vi.fn()
  const onInsert = vi.fn()
  const utils = render(<SearchHelp onClose={onClose} onInsert={onInsert} {...props} />)
  return { onClose, onInsert, ...utils }
}

describe('SearchHelp', () => {
  it('lists the documented field examples', () => {
    renderHelp()
    expect(screen.getByText('title:avatar')).toBeInTheDocument()
    expect(screen.getByText('author:"Gary Gygax"')).toBeInTheDocument()
    expect(screen.getByText('text:fireball')).toBeInTheDocument()
  })

  it('inserts an example when it is clicked, so the syntax is learned by running it', async () => {
    const { onInsert } = renderHelp()
    await userEvent.click(screen.getByText('title:avatar'))
    expect(onInsert).toHaveBeenCalledWith('title:avatar')
  })

  it('closes on the close button', async () => {
    const { onClose } = renderHelp()
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const { onClose } = renderHelp()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a click outside the panel', async () => {
    const { onClose } = renderHelp()
    await userEvent.click(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close on a click inside the panel', async () => {
    const { onClose } = renderHelp()
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('is a labelled dialog and moves focus into itself for keyboard users', () => {
    renderHelp()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close/i })).toHaveFocus()
  })
})
