import { describe, it, expect } from 'vitest'
import {
  addCombatant,
  goesFirst,
  markActed,
  nextRound,
  nextTurn,
  previousTurn,
  removeCombatant,
  sortByScore,
  updateCombatant,
} from './initiative'
import type { Combatant, InitiativeState, Side } from './types'

const SIDES: Side[] = [
  { key: 'heroes', label: 'Heroes' },
  { key: 'director', label: 'Director' },
]

const entry = (id: string, side = 'heroes', score: number | null = null): Combatant => ({
  id,
  name: id,
  score,
  side,
  acted: false,
  note: '',
  character_id: null,
})

const state = (entries: Combatant[], extra: Partial<InitiativeState> = {}): InitiativeState => ({
  round: 1,
  turn: 0,
  side: 'heroes',
  first: 'heroes',
  entries,
  ...extra,
})

describe('ordered turns', () => {
  it('walks the list and starts a new round past the end', () => {
    let s = state([entry('a'), entry('b')])
    s = nextTurn(s)
    expect([s.turn, s.round]).toEqual([1, 1])
    s = nextTurn(s)
    expect([s.turn, s.round]).toEqual([0, 2])
    s = previousTurn(s)
    expect([s.turn, s.round]).toEqual([1, 1])
    s = previousTurn(previousTurn(s))
    expect([s.turn, s.round]).toEqual([0, 1])
    expect(nextTurn(state([]))).toEqual(state([]))
  })

  it('sorts highest first, with no score last in the order added', () => {
    const sorted = sortByScore(
      state(
        [entry('slow', 'heroes', 3), entry('none'), entry('fast', 'heroes', 18), entry('also')],
        {
          turn: 2,
        }
      )
    )
    expect(sorted.entries.map((e) => e.id)).toEqual(['fast', 'slow', 'none', 'also'])
    expect(sorted.turn).toBe(0)
  })

  it('keeps the turn with whoever had it when someone leaves', () => {
    const s = state([entry('a'), entry('b'), entry('c')], { turn: 2 })
    expect(removeCombatant(s, 'a').turn).toBe(1)
    expect(removeCombatant(s, 'c').turn).toBe(1)
    expect(removeCombatant(s, 'missing')).toBe(s)
  })
})

describe('sides take turns', () => {
  it('passes the turn once one of the acting side has gone', () => {
    let s = state([entry('hero1'), entry('hero2'), entry('goblin', 'director')])
    s = markActed(s, SIDES, 'hero1', true)
    expect(s.side).toBe('director')
    s = markActed(s, SIDES, 'goblin', true)
    // The director has no one left, so the heroes keep going.
    expect(s.side).toBe('heroes')
    s = markActed(s, SIDES, 'hero2', true)
    expect(s.side).toBe('heroes')
    expect(s.entries.every((e) => e.acted)).toBe(true)
  })

  it('does not pass the turn when the other side is marked or a mark is cleared', () => {
    const s = state([entry('hero'), entry('goblin', 'director')])
    expect(markActed(s, SIDES, 'goblin', true).side).toBe('heroes')
    expect(markActed(s, SIDES, 'hero', false).side).toBe('heroes')
  })

  it('clears every mark at the next round and starts with the side that goes first', () => {
    let s = goesFirst(state([entry('hero'), entry('goblin', 'director')]), 'director')
    expect([s.first, s.side]).toEqual(['director', 'director'])
    s = markActed(markActed(s, SIDES, 'goblin', true), SIDES, 'hero', true)
    s = nextRound(s)
    expect(s.round).toBe(2)
    expect(s.side).toBe('director')
    expect(s.entries.some((e) => e.acted)).toBe(false)
  })
})

it('adds and edits combatants', () => {
  let s = addCombatant(state([]), { name: 'Ogre', side: 'director', score: 12 })
  expect(s.entries[0]).toMatchObject({ name: 'Ogre', side: 'director', score: 12, acted: false })
  s = updateCombatant(s, s.entries[0].id, { note: 'bloodied' })
  expect(s.entries[0].note).toBe('bloodied')
})
