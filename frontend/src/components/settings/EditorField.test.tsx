import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EditorField from './EditorField'

describe('EditorField', () => {
  it('names the group around its control after its caption', () => {
    render(
      <EditorField label="Role">
        <select aria-label="Role picker">
          <option>GM</option>
        </select>
      </EditorField>
    )
    expect(screen.getByRole('group', { name: 'Role' })).toContainElement(
      screen.getByRole('combobox')
    )
  })
})
