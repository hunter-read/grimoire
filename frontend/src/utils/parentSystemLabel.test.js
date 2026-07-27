import { describe, it, expect } from 'vitest'
import { parentSystemLabel } from './parentSystemLabel'

describe('parentSystemLabel', () => {
  it('combines parent system and edition', () => {
    expect(parentSystemLabel({ parent_system: 'Cyberpunk', edition: 'Red' })).toBe('Cyberpunk Red')
  })

  it('returns just the parent when there is no edition', () => {
    expect(parentSystemLabel({ parent_system: 'Dungeons & Dragons', edition: '' })).toBe(
      'Dungeons & Dragons'
    )
  })

  it('returns just the edition when there is no parent', () => {
    expect(parentSystemLabel({ parent_system: '', edition: '2e' })).toBe('2e')
  })

  it('trims surrounding whitespace on each part', () => {
    expect(parentSystemLabel({ parent_system: '  Cyberpunk ', edition: ' 2020 ' })).toBe(
      'Cyberpunk 2020'
    )
  })

  it('returns an empty string for a bare or missing system', () => {
    expect(parentSystemLabel({})).toBe('')
    expect(parentSystemLabel(null)).toBe('')
  })
})
