import { describe, it, expect } from 'vitest'
import {
  countSpreadImages,
  findSection,
  formatPageSpec,
  isLeftPage,
  pageLabel,
  parsePageSpec,
  safeStem,
} from './pageRanges'

describe('parsePageSpec', () => {
  it('reads single pages, ranges and lists in written order', () => {
    expect(parsePageSpec('7, 2-3, 3', 10)).toEqual({ pages: [7, 2, 3] })
  })

  it('reads a backwards range forwards and accepts typographic dashes', () => {
    expect(parsePageSpec('5-3', 10)).toEqual({ pages: [3, 4, 5] })
    expect(parsePageSpec('1–2', 10)).toEqual({ pages: [1, 2] })
  })

  it.each([
    ['', 'empty'],
    [' , ', 'empty'],
    ['abc', 'notAPage'],
    ['0', 'fromOne'],
    ['11', 'pastEnd'],
  ])('flags %j as %s', (spec, key) => {
    expect(parsePageSpec(spec, 10).error!.key).toBe(key)
  })

  it('skips the end check when the page count is unknown', () => {
    expect(parsePageSpec('400', 0)).toEqual({ pages: [400] })
  })
})

describe('naming', () => {
  it('formats specs and labels', () => {
    expect(formatPageSpec([4])).toBe('4')
    expect(formatPageSpec([4, 5])).toBe('4-5')
    expect(formatPageSpec([])).toBe('')
    expect(pageLabel([4])).toBe('p4')
    expect(pageLabel([5, 4])).toBe('p4-5')
  })

  it('makes a filename stem like the server does', () => {
    expect(safeStem('Mörk: Borg / "Core"?')).toBe('Mörk Borg Core')
    expect(safeStem('...')).toBe('export')
    expect(safeStem('x'.repeat(400))).toHaveLength(150)
  })
})

describe('spreads', () => {
  it('pairs pages like the reader', () => {
    expect(isLeftPage(2, 0)).toBe(true)
    expect(isLeftPage(1, 0)).toBe(false)
    expect(isLeftPage(1, 1)).toBe(true)
  })

  it('counts the images joined spreads make', () => {
    expect(countSpreadImages([1, 2, 3, 4, 5], 0)).toBe(3)
    expect(countSpreadImages([1, 2, 3, 4, 5], 1)).toBe(3)
    expect(countSpreadImages([3, 4, 5, 6], 0)).toBe(3)
  })
})

describe('findSection', () => {
  const toc = [
    { title: 'Intro', page: 1, children: [] },
    {
      title: 'Rules',
      page: 10,
      children: [
        { title: 'Combat', page: 12, children: [] },
        { title: 'Magic', page: 20, children: [] },
      ],
    },
    { title: 'Character Sheet', page: 40, children: [] },
  ]

  it('finds the deepest section a page sits in', () => {
    expect(findSection(toc, 15, 44)).toEqual({ title: 'Combat', start: 12, end: 19 })
  })

  it('runs a nested last child to the next shallower entry', () => {
    expect(findSection(toc, 25, 44)).toEqual({ title: 'Magic', start: 20, end: 39 })
  })

  it('runs the last section to the end of the book', () => {
    expect(findSection(toc, 42, 44)).toEqual({ title: 'Character Sheet', start: 40, end: 44 })
  })

  it('is null before the first entry or without a toc', () => {
    expect(findSection([{ title: 'Late', page: 5, children: [] }], 2, 10)).toBeNull()
    expect(findSection([], 2, 10)).toBeNull()
  })
})
