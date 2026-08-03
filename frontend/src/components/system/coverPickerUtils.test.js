import { describe, it, expect } from 'vitest'
import { sortForCoverPicker } from './coverPickerUtils'

const book = (id, category, title = id, has_thumbnail = true) => ({
  id,
  category,
  title,
  has_thumbnail,
})

describe('sortForCoverPicker', () => {
  it('puts core books first', () => {
    // The cover is nearly always a core rulebook, so those should not be
    // buried behind dozens of handouts.
    const books = [book('a', 'adventure'), book('c', 'core'), book('s', 'supplement')]
    expect(sortForCoverPicker(books).map((b) => b.id)).toEqual(['c', 's', 'a'])
  })

  it('follows the library category order', () => {
    const books = [
      book('homebrew', 'homebrew'),
      book('adventure', 'adventure'),
      book('starter', 'starter-set'),
      book('core', 'core'),
    ]
    expect(sortForCoverPicker(books).map((b) => b.id)).toEqual([
      'core',
      'starter',
      'adventure',
      'homebrew',
    ])
  })

  it('sorts unknown categories last', () => {
    const books = [book('weird', 'something-else'), book('core', 'core')]
    expect(sortForCoverPicker(books).map((b) => b.id)).toEqual(['core', 'weird'])
  })

  it('treats a missing category as unknown', () => {
    const books = [book('none', undefined), book('core', 'core')]
    expect(sortForCoverPicker(books).map((b) => b.id)).toEqual(['core', 'none'])
  })

  it('sorts by title within a category', () => {
    const books = [book('b', 'core', 'Zebra'), book('a', 'core', 'Alpha')]
    expect(sortForCoverPicker(books).map((b) => b.id)).toEqual(['a', 'b'])
  })

  it('pins the selected cover to the front', () => {
    // Otherwise the current selection can vanish behind "load more".
    const books = [book('core', 'core'), book('far', 'homebrew')]
    expect(sortForCoverPicker(books, 'far')[0].id).toBe('far')
  })

  it('drops books with no thumbnail', () => {
    const books = [book('core', 'core'), book('nothumb', 'core', 'No Thumb', false)]
    expect(sortForCoverPicker(books).map((b) => b.id)).toEqual(['core'])
  })

  it('copes with no books at all', () => {
    expect(sortForCoverPicker([])).toEqual([])
    expect(sortForCoverPicker(null)).toEqual([])
    expect(sortForCoverPicker(undefined)).toEqual([])
  })

  it('does not mutate its input', () => {
    const books = [book('b', 'homebrew'), book('a', 'core')]
    const before = books.map((x) => x.id)
    sortForCoverPicker(books)
    expect(books.map((x) => x.id)).toEqual(before)
  })
})
