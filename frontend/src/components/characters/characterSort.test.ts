import { describe, it, expect, beforeEach } from 'vitest'
import type { Schema } from '../../api'
import {
  compareVersions,
  getCharacterSort,
  groupBySystem,
  saveCharacterSort,
  sortCharacters,
} from './characterSort'

type CharacterSummary = Schema<'CharacterSummary'>

const character = (over: Partial<CharacterSummary>): CharacterSummary => ({
  id: over.name || 'id',
  name: '',
  schema_ref: 'dnd-5e',
  schema_name: 'D&D 5e',
  schema_version: '1.0.0',
  system: 'D&D 5e',
  status: 'active',
  ...over,
})

const names = (list: CharacterSummary[]) => list.map((c) => c.name)

describe('sortCharacters', () => {
  it('keeps the server order for recently updated, players first', () => {
    const list = [
      character({ name: 'Fallen', status: 'dead' }),
      character({ name: 'Zed' }),
      character({ name: 'Ada' }),
    ]
    expect(names(sortCharacters(list, 'updated'))).toEqual(['Zed', 'Ada', 'Fallen'])
  })

  it('sorts by name either way, with untitled characters last', () => {
    const list = [
      character({ name: 'bram' }),
      character({ name: '' }),
      character({ name: 'Ada' }),
      character({ name: 'Cleo' }),
    ]
    expect(names(sortCharacters(list, 'name'))).toEqual(['Ada', 'bram', 'Cleo', ''])
    expect(names(sortCharacters(list, 'name-desc'))).toEqual(['Cleo', 'bram', 'Ada', ''])
  })

  it('still puts retired and fallen characters after the ones being played', () => {
    const list = [character({ name: 'Ada', status: 'retired' }), character({ name: 'Zed' })]
    expect(names(sortCharacters(list, 'name'))).toEqual(['Zed', 'Ada'])
  })

  it('gathers each system, players first within it and no system last', () => {
    const list = [
      character({ name: 'Nobody', system: '' }),
      character({ name: 'Rook', system: 'Pathfinder', status: 'dead' }),
      character({ name: 'Vex', system: 'D&D 5e' }),
      character({ name: 'Kas', system: 'Pathfinder' }),
    ]
    expect(names(sortCharacters(list, 'system'))).toEqual(['Vex', 'Kas', 'Rook', 'Nobody'])
  })

  it('sorts by sheet, newest version first', () => {
    const list = [
      character({ name: 'Old', schema_version: '1.9.0' }),
      character({ name: 'New', schema_version: '1.10.0' }),
      character({ name: 'Blades', schema_name: 'Blades', schema_version: '2.0.0' }),
      character({ name: 'Orphan', schema_name: '', schema_ref: 'zz-gone', schema_version: '' }),
    ]
    expect(names(sortCharacters(list, 'sheet'))).toEqual(['Blades', 'New', 'Old', 'Orphan'])
  })

  it('does not change the list it is given', () => {
    const list = [character({ name: 'B' }), character({ name: 'A' })]
    sortCharacters(list, 'name')
    expect(names(list)).toEqual(['B', 'A'])
  })
})

describe('compareVersions', () => {
  it('compares each part as a number', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('2.0.0-beta', '2.0.0-alpha')).toBeGreaterThan(0)
  })
})

describe('groupBySystem', () => {
  it('splits a system-sorted list into one run per system', () => {
    const groups = groupBySystem([
      character({ name: 'A', system: 'D&D 5e' }),
      character({ name: 'B', system: 'D&D 5e' }),
      character({ name: 'C', system: '' }),
    ])
    expect(groups.map((g) => [g.system, names(g.characters)])).toEqual([
      ['D&D 5e', ['A', 'B']],
      ['', ['C']],
    ])
  })
})

describe('the remembered sort', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to recently updated and ignores an unknown value', () => {
    expect(getCharacterSort()).toBe('updated')
    expect(getCharacterSort({ characterSort: 'nonsense' })).toBe('updated')
  })

  it('reads back what was saved', () => {
    saveCharacterSort('system')
    expect(getCharacterSort()).toBe('system')
  })
})
