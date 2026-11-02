import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import usePageTitle, { APP_TITLE } from './usePageTitle'

describe('usePageTitle', () => {
  beforeEach(() => {
    document.title = APP_TITLE
  })

  it('names the tab after the page', () => {
    renderHook(() => usePageTitle('Dungeon World'))
    expect(document.title).toBe('Dungeon World - Grimoire')
  })

  it('leaves the title alone while the page has no name yet', () => {
    document.title = 'Something - Grimoire'
    renderHook(() => usePageTitle(null))
    expect(document.title).toBe('Something - Grimoire')
  })

  it('follows a change of name', () => {
    const { rerender } = renderHook(({ title }) => usePageTitle(title), {
      initialProps: { title: 'Alpha' },
    })
    rerender({ title: 'Beta' })
    expect(document.title).toBe('Beta - Grimoire')
  })

  it('puts the plain app name back on unmount', () => {
    const { unmount } = renderHook(() => usePageTitle('Alpha'))
    unmount()
    expect(document.title).toBe(APP_TITLE)
  })
})
