import { describe, it, expect } from 'vitest'
import { publicationDate } from './bookDetails'

describe('publicationDate', () => {
  it('shows the year alone when that is all there is', () => {
    expect(publicationDate({ year: 2016 })).toBe('2016')
  })

  it('adds the month when known', () => {
    // Precision follows the data — no inventing a day that was never recorded.
    expect(publicationDate({ year: 2016, month: 3 }, 'en-US')).toBe('March 2016')
  })

  it('adds the day when known', () => {
    expect(publicationDate({ year: 2016, month: 3, day: 14 }, 'en-US')).toBe('March 14, 2016')
  })

  it('is empty without a year', () => {
    // A month with no year says nothing useful.
    expect(publicationDate({ month: 3, day: 14 })).toBe('')
    expect(publicationDate({})).toBe('')
    expect(publicationDate(null)).toBe('')
  })

  it('falls back to the year for a nonsensical month', () => {
    expect(publicationDate({ year: 2016, month: 99 }, 'en-US')).toContain('2016')
  })
})
