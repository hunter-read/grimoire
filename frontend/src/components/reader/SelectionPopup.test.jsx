import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SelectionPopup from './SelectionPopup'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: () => 'Bookmark selection' }),
}))

describe('SelectionPopup', () => {
  it('renders the bookmark button and calls onBookmark with page + text', () => {
    const onBookmark = vi.fn()
    render(
      <SelectionPopup
        selectionPopup={{ x: 100, y: 200, text: 'a spell', page: 7 }}
        onBookmark={onBookmark}
      />
    )
    fireEvent.mouseDown(screen.getByText('Bookmark selection'))
    expect(onBookmark).toHaveBeenCalledWith(7, 'a spell')
  })
})
