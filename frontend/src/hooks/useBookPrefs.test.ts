import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  clearRecentBooks,
  getBookPrefs,
  removeRecentBook,
  setRecentAccount,
  saveBookPrefs,
  getRecentBooks,
  getRecentLimit,
  saveRecentBook,
  RECENT_DEFAULT,
  RECENT_MAX,
} from './useBookPrefs'

function setRecentLimit(value: unknown) {
  localStorage.setItem('grimoire:user-prefs', JSON.stringify({ recentLimit: value }))
}

function makeBook(id: string) {
  return { id, title: `Book ${id}`, has_thumbnail: false, page_count: 10 }
}

describe('useBookPrefs', () => {
  beforeEach(() => {
    localStorage.clear()
    setRecentAccount('user-a')
  })

  afterEach(() => {
    setRecentAccount(null)
  })

  it('returns empty object for an unknown book', () => {
    expect(getBookPrefs('no-such-book')).toEqual({})
  })

  it('saves and retrieves prefs', () => {
    saveBookPrefs('book-1', { page: 5, zoom: 1.5 })
    expect(getBookPrefs('book-1')).toEqual({ page: 5, zoom: 1.5 })
  })

  it('merges new keys with existing prefs', () => {
    saveBookPrefs('book-1', { page: 3 })
    saveBookPrefs('book-1', { zoom: 2 })
    expect(getBookPrefs('book-1')).toEqual({ page: 3, zoom: 2 })
  })

  it('overwrites existing keys', () => {
    saveBookPrefs('book-1', { page: 1 })
    saveBookPrefs('book-1', { page: 42 })
    expect(getBookPrefs('book-1')).toEqual({ page: 42 })
  })

  it('isolates prefs by book id', () => {
    saveBookPrefs('book-1', { page: 1 })
    saveBookPrefs('book-2', { page: 99 })
    expect(getBookPrefs('book-1')).toEqual({ page: 1 })
    expect(getBookPrefs('book-2')).toEqual({ page: 99 })
  })

  it('returns empty object when localStorage contains invalid JSON', () => {
    localStorage.setItem('grimoire:book:bad-book', 'not-json{{{')
    expect(getBookPrefs('bad-book')).toEqual({})
  })

  describe('recently opened limit', () => {
    it('defaults to RECENT_DEFAULT when unset', () => {
      expect(getRecentLimit()).toBe(RECENT_DEFAULT)
    })

    it('clamps the configured limit to [0, RECENT_MAX]', () => {
      setRecentLimit(500)
      expect(getRecentLimit()).toBe(RECENT_MAX)
      setRecentLimit(-3)
      expect(getRecentLimit()).toBe(0)
      setRecentLimit(7)
      expect(getRecentLimit()).toBe(7)
    })

    it('keeps only up to the configured number of recent books', () => {
      setRecentLimit(3)
      for (let i = 1; i <= 5; i++) saveRecentBook(makeBook(`b${i}`))
      const recent = getRecentBooks()
      expect(recent).toHaveLength(3)
      // Most recently opened is first.
      expect(recent[0].id).toBe('b5')
    })

    it('moves a re-opened book to the front without duplicating it', () => {
      setRecentLimit(5)
      saveRecentBook(makeBook('a'))
      saveRecentBook(makeBook('b'))
      saveRecentBook(makeBook('a'))
      const recent = getRecentBooks()
      expect(recent.map((b) => b.id)).toEqual(['a', 'b'])
    })

    it('disables recent tracking when the limit is 0', () => {
      setRecentLimit(0)
      saveRecentBook(makeBook('a'))
      expect(getRecentBooks()).toEqual([])
    })

    it('hides existing recent books immediately when limit is set to 0', () => {
      setRecentLimit(5)
      saveRecentBook(makeBook('a'))
      setRecentLimit(0)
      expect(getRecentBooks()).toEqual([])
    })
  })

  describe('recently opened, per account', () => {
    it('keeps a separate list for each account', () => {
      saveRecentBook(makeBook('a1'))
      setRecentAccount('user-b')
      expect(getRecentBooks()).toEqual([])
      saveRecentBook(makeBook('b1'))
      expect(getRecentBooks().map((b) => b.id)).toEqual(['b1'])
      setRecentAccount('user-a')
      expect(getRecentBooks().map((b) => b.id)).toEqual(['a1'])
      expect(localStorage.getItem('grimoire:recently-opened:user-a')).toContain('a1')
    })

    it('neither records nor shows anything while nobody is signed in', () => {
      saveRecentBook(makeBook('a1'))
      setRecentAccount(null)
      saveRecentBook(makeBook('x'))
      expect(getRecentBooks()).toEqual([])
      removeRecentBook('a1')
      setRecentAccount('user-a')
      expect(getRecentBooks().map((b) => b.id)).toEqual(['a1'])
    })

    it('drops the old list that was shared by the whole browser', () => {
      localStorage.setItem(
        'grimoire:recently-opened',
        JSON.stringify([{ ...makeBook('old'), openedAt: 1 }])
      )
      setRecentAccount('user-b')
      expect(getRecentBooks()).toEqual([])
      expect(localStorage.getItem('grimoire:recently-opened')).toBeNull()
    })

    it('removes one book from the current list', () => {
      saveRecentBook(makeBook('a1'))
      saveRecentBook(makeBook('a2'))
      removeRecentBook('a1')
      expect(getRecentBooks().map((b) => b.id)).toEqual(['a2'])
    })

    it('clears every account list, and nothing else', () => {
      saveRecentBook(makeBook('a1'))
      setRecentAccount('user-b')
      saveRecentBook(makeBook('b1'))
      localStorage.setItem('grimoire:recently-opened', '[]')
      saveBookPrefs('a1', { page: 3 })
      clearRecentBooks()
      expect(getRecentBooks()).toEqual([])
      setRecentAccount('user-a')
      expect(getRecentBooks()).toEqual([])
      expect(localStorage.getItem('grimoire:recently-opened')).toBeNull()
      expect(getBookPrefs('a1')).toEqual({ page: 3 })
    })
  })
})
