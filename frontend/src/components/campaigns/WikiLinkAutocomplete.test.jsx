import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WikiLinkAutocomplete, { findActiveLinkQuery } from './WikiLinkAutocomplete'

describe('findActiveLinkQuery', () => {
  it('finds the query when the caret sits inside an open [[', () => {
    const text = 'see [[Bob'
    expect(findActiveLinkQuery(text, text.length)).toEqual({
      query: 'Bob',
      start: 4,
      end: 9,
    })
  })

  it('returns an empty query right after the brackets', () => {
    expect(findActiveLinkQuery('see [[', 6).query).toBe('')
  })

  it('returns null when there is no [[ before the caret', () => {
    expect(findActiveLinkQuery('plain text', 10)).toBe(null)
  })

  it('returns null once the link is closed', () => {
    const text = 'see [[Bob]] and more'
    expect(findActiveLinkQuery(text, text.length)).toBe(null)
  })

  it('does not span a newline', () => {
    const text = 'see [[\nnext line'
    expect(findActiveLinkQuery(text, text.length)).toBe(null)
  })

  it('tracks the nearest [[ when several appear', () => {
    const text = '[[One]] then [[Tw'
    expect(findActiveLinkQuery(text, text.length)).toEqual({
      query: 'Tw',
      start: 13,
      end: 17,
    })
  })

  it('ignores text after the caret', () => {
    const text = 'see [[Bob]] tail'
    // Caret placed mid-query, before the closing brackets.
    expect(findActiveLinkQuery(text, 9).query).toBe('Bob')
  })
})

describe('WikiLinkAutocomplete', () => {
  const matches = [
    { key: 'page:p1', label: 'Boblin the Goblin', detail: null, target: 'Boblin the Goblin' },
    {
      key: 'head:p1:2:Loot',
      label: 'Boblin the Goblin › Loot',
      detail: 'H2',
      target: 'Boblin the Goblin:#Loot',
    },
  ]

  const renderList = (props = {}) =>
    render(
      <WikiLinkAutocomplete
        matches={matches}
        position={{ top: 20, left: 10 }}
        activeIndex={0}
        onActiveIndexChange={() => {}}
        onAccept={() => {}}
        {...props}
      />
    )

  it('renders one option per match', () => {
    renderList()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByText('Boblin the Goblin')).toBeTruthy()
    expect(screen.getByText('Boblin the Goblin › Loot')).toBeTruthy()
  })

  it('marks the active row as selected', () => {
    renderList({ activeIndex: 1 })
    const options = screen.getAllByRole('option')
    expect(options[0].getAttribute('aria-selected')).toBe('false')
    expect(options[1].getAttribute('aria-selected')).toBe('true')
  })

  it('shows the heading level for a heading completion', () => {
    renderList()
    expect(screen.getByText('H2')).toBeTruthy()
  })

  it('accepts a match on mousedown, keeping focus in the textarea', () => {
    const onAccept = vi.fn()
    renderList({ onAccept })
    const option = screen.getAllByRole('option')[1]
    // mousedown (not click) so the editor's textarea never loses focus.
    fireEvent.mouseDown(option)
    expect(onAccept).toHaveBeenCalledWith(matches[1])
  })

  it('renders nothing when there are no matches', () => {
    const { container } = renderList({ matches: [] })
    expect(container.firstChild).toBe(null)
  })
})
