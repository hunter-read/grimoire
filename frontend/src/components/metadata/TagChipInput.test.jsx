import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagChipInput from './TagChipInput'

function Harness({ initial = [] }) {
  const [tags, setTags] = useState(initial)
  const [input, setInput] = useState('')
  return (
    <TagChipInput
      id="t"
      tags={tags}
      onChange={setTags}
      inputValue={input}
      onInputChange={setInput}
      placeholder="add tag…"
    />
  )
}

describe('TagChipInput', () => {
  it('adds a lowercased tag on Enter', async () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText('add tag…')
    await userEvent.type(input, 'OSR{Enter}')
    expect(screen.getByText('osr')).toBeInTheDocument()
  })

  it('adds on comma and ignores duplicates', async () => {
    render(<Harness initial={['osr']} />)
    const input = screen.getByRole('textbox')
    await userEvent.type(input, 'osr,')
    expect(screen.getAllByText('osr')).toHaveLength(1)
  })

  it('removes the last tag on Backspace when empty', async () => {
    render(<Harness initial={['a', 'b']} />)
    const input = screen.getByRole('textbox')
    input.focus()
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(screen.queryByText('b')).not.toBeInTheDocument()
    expect(screen.getByText('a')).toBeInTheDocument()
  })

  it('removes a tag via its chip button', async () => {
    render(<Harness initial={['keep', 'drop']} />)
    await userEvent.click(screen.getByLabelText('Remove drop'))
    expect(screen.queryByText('drop')).not.toBeInTheDocument()
  })
})
