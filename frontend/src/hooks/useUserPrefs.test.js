import { describe, it, expect, beforeEach } from 'vitest'
import { getUserPrefs, saveUserPref, getFolderPlacement } from './useUserPrefs'

const KEY = 'grimoire:user-prefs'

describe('useUserPrefs', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getUserPrefs', () => {
    it('returns an empty object when nothing is stored', () => {
      expect(getUserPrefs()).toEqual({})
    })

    it('returns parsed preferences from localStorage', () => {
      localStorage.setItem(KEY, JSON.stringify({ readerMode: 'spread', wheelNav: false }))
      expect(getUserPrefs()).toEqual({ readerMode: 'spread', wheelNav: false })
    })

    it('returns an empty object when stored value is invalid JSON', () => {
      localStorage.setItem(KEY, 'not-json{{{')
      expect(getUserPrefs()).toEqual({})
    })
  })

  describe('saveUserPref', () => {
    it('writes a new preference key without overwriting others', () => {
      localStorage.setItem(KEY, JSON.stringify({ readerMode: 'page' }))
      saveUserPref('wheelNav', false)
      expect(getUserPrefs()).toEqual({ readerMode: 'page', wheelNav: false })
    })

    it('overwrites an existing key', () => {
      localStorage.setItem(KEY, JSON.stringify({ readerMode: 'page' }))
      saveUserPref('readerMode', 'spread')
      expect(getUserPrefs().readerMode).toBe('spread')
    })

    it('creates the key entry when localStorage is empty', () => {
      saveUserPref('cardSize', 'compact')
      expect(getUserPrefs()).toEqual({ cardSize: 'compact' })
    })

    it('stores string, boolean, and null values correctly', () => {
      saveUserPref('str', 'hello')
      saveUserPref('bool', true)
      saveUserPref('flag', false)
      const prefs = getUserPrefs()
      expect(prefs.str).toBe('hello')
      expect(prefs.bool).toBe(true)
      expect(prefs.flag).toBe(false)
    })
  })

  describe('getFolderPlacement', () => {
    it('defaults to folders first', () => {
      expect(getFolderPlacement()).toBe('first')
    })

    it('returns the saved placement', () => {
      saveUserPref('folderPlacement', 'mixed')
      expect(getFolderPlacement()).toBe('mixed')
    })

    it('ignores an unknown stored value', () => {
      expect(getFolderPlacement({ folderPlacement: 'last' })).toBe('first')
    })
  })
})
