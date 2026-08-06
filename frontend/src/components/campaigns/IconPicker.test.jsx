import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IconPicker from './IconPicker'

const open = async (user) => {
  await user.click(screen.getByRole('button', { name: 'Choose an icon' }))
  return screen.getByRole('dialog', { name: 'Choose an icon' })
}

describe('IconPicker', () => {
  it('opens and closes the popover from the trigger', async () => {
    const user = userEvent.setup()
    render(<IconPicker value="" onChange={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await open(user)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Choose an icon' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<IconPicker value="" onChange={vi.fn()} />)
    await open(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on an outside click', async () => {
    const user = userEvent.setup()
    render(<IconPicker value="" onChange={vi.fn()} />)
    await open(user)
    await user.click(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('picks a built-in icon and stays open', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<IconPicker value="" onChange={onChange} />)
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('button', { name: 'castle' }))
    expect(onChange).toHaveBeenCalledWith('castle')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('allows changing the icon again without reopening', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<IconPicker value="" onChange={onChange} />)
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('button', { name: 'castle' }))
    await user.click(within(dialog).getByRole('button', { name: 'rabbit' }))
    expect(onChange).toHaveBeenNthCalledWith(1, 'castle')
    expect(onChange).toHaveBeenNthCalledWith(2, 'rabbit')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('filters the grid as you type, and reports no results', async () => {
    const user = userEvent.setup()
    render(<IconPicker value="" onChange={vi.fn()} />)
    const dialog = await open(user)
    const search = within(dialog).getByRole('searchbox', { name: 'Search icons' })

    await user.type(search, 'castle')
    expect(within(dialog).getByRole('button', { name: 'castle' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'rabbit' })).toBeNull()

    await user.clear(search)
    await user.type(search, 'zzzznope')
    expect(within(dialog).getByText('No matching icons')).toBeInTheDocument()
  })

  it('finds an icon by keyword rather than key', async () => {
    const user = userEvent.setup()
    render(<IconPicker value="" onChange={vi.fn()} />)
    const dialog = await open(user)
    await user.type(within(dialog).getByRole('searchbox'), 'disguise')
    expect(within(dialog).getByRole('button', { name: 'mask' })).toBeInTheDocument()
  })

  it('switches to the emoji tab and picks an emoji', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<IconPicker value="" onChange={onChange} />)
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('tab', { name: 'Emoji' }))
    await user.click(within(dialog).getByRole('button', { name: '🐉' }))
    expect(onChange).toHaveBeenCalledWith('🐉')
  })

  it('clears the icon via the "no icon" cell', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<IconPicker value="castle" onChange={onChange} />)
    const dialog = await open(user)
    await user.click(within(dialog).getByRole('button', { name: 'No icon' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('resets the search between openings', async () => {
    const user = userEvent.setup()
    render(<IconPicker value="" onChange={vi.fn()} />)
    let dialog = await open(user)
    await user.type(within(dialog).getByRole('searchbox'), 'castle')
    await user.keyboard('{Escape}')
    dialog = await open(user)
    expect(within(dialog).getByRole('searchbox')).toHaveValue('')
  })

  describe('colour row', () => {
    it('is hidden without an onColorChange handler', async () => {
      const user = userEvent.setup()
      render(<IconPicker value="" onChange={vi.fn()} />)
      const dialog = await open(user)
      expect(within(dialog).queryByText('Colour')).toBeNull()
    })

    it('reports a preset selection', async () => {
      const user = userEvent.setup()
      const onColorChange = vi.fn()
      render(<IconPicker value="castle" onChange={vi.fn()} onColorChange={onColorChange} />)
      const dialog = await open(user)
      await user.click(within(dialog).getByRole('button', { name: 'Blue' }))
      expect(onColorChange).toHaveBeenCalledWith('blue')
    })

    it('reports clearing the tint', async () => {
      const user = userEvent.setup()
      const onColorChange = vi.fn()
      render(
        <IconPicker value="castle" color="blue" onChange={vi.fn()} onColorChange={onColorChange} />
      )
      const dialog = await open(user)
      await user.click(within(dialog).getByRole('button', { name: 'Default colour' }))
      expect(onColorChange).toHaveBeenCalledWith('')
    })

    it('reports a custom hex from the colour input', async () => {
      const onColorChange = vi.fn()
      const user = userEvent.setup()
      render(<IconPicker value="castle" onChange={vi.fn()} onColorChange={onColorChange} />)
      const dialog = await open(user)
      const input = within(dialog).getByLabelText('Custom colour')
      // A colour input can't be typed into; drive it through React's change event.
      fireEvent.change(input, { target: { value: '#123456' } })
      expect(onColorChange).toHaveBeenCalledWith('#123456')
    })

    it('tints the trigger with the stored colour', () => {
      render(<IconPicker value="castle" color="blue" onChange={vi.fn()} onColorChange={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'Choose an icon' }).style.color).toBe(
        'rgb(85, 144, 212)'
      )
    })

    it('falls back to the default trigger colour when untinted', () => {
      render(<IconPicker value="castle" onChange={vi.fn()} onColorChange={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'Choose an icon' }).style.color).toBe(
        'var(--text-dim)'
      )
    })
  })
})
