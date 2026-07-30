import { describe, it, expect } from 'vitest'
import { capitalizeWord, ACRONYMS } from './acronyms'

describe('capitalizeWord', () => {
  it('title-cases ordinary words', () => {
    expect(capitalizeWord('tools')).toBe('Tools')
    expect(capitalizeWord('portraits')).toBe('Portraits')
  })

  it('keeps known acronyms uppercase', () => {
    expect(capitalizeWord('gm')).toBe('GM')
    expect(capitalizeWord('GM')).toBe('GM')
    expect(capitalizeWord('npc')).toBe('NPC')
    expect(capitalizeWord('rpg')).toBe('RPG')
  })

  it('handles acronym plurals', () => {
    expect(capitalizeWord('rpgs')).toBe('RPGs')
    expect(capitalizeWord('gms')).toBe('GMs')
  })

  it('handles acronym possessives', () => {
    expect(capitalizeWord("gm's")).toBe("GM's")
    expect(capitalizeWord("dm's")).toBe("DM's")
  })

  it('returns empty/falsey input unchanged', () => {
    expect(capitalizeWord('')).toBe('')
    expect(capitalizeWord(undefined)).toBe(undefined)
  })

  it('exposes a lowercase-keyed acronym table', () => {
    expect(ACRONYMS.gm).toBe('GM')
    expect(ACRONYMS.ttrpg).toBe('TTRPG')
  })
})
