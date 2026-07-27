import { describe, it, expect } from 'vitest'
import {
  DICE_MATERIAL_GROUPS,
  isDefaultDiceMaterial,
  buildDiceMaterialRows,
  groupsFromManaged,
} from './diceMaterials'

describe('diceMaterials', () => {
  it('defines the Dice/Cards/Other default groups', () => {
    const labels = DICE_MATERIAL_GROUPS.map((g) => g.label)
    expect(labels).toEqual(['Dice', 'Cards', 'Other'])
    const dice = DICE_MATERIAL_GROUPS.find((g) => g.key === 'dice')
    expect(dice.items).toContain('D20')
    expect(dice.items).toContain('Custom (System specific)')
  })

  it('recognizes default values case-insensitively', () => {
    expect(isDefaultDiceMaterial('d20')).toBe(true)
    expect(isDefaultDiceMaterial('Tarot Cards')).toBe(true)
    expect(isDefaultDiceMaterial('Homebrew Widget')).toBe(false)
  })

  it('builds group headers followed by their items', () => {
    const rows = buildDiceMaterialRows([])
    expect(rows[0]).toMatchObject({ type: 'group', label: 'Dice' })
    expect(rows[1]).toMatchObject({ type: 'item', value: 'D4' })
  })

  it('appends selected custom values under a Custom group', () => {
    const rows = buildDiceMaterialRows(['D6', 'Homebrew Widget'], 'Custom')
    const customHeader = rows.find((r) => r.type === 'group' && r.label === 'Custom')
    expect(customHeader).toBeTruthy()
    const customItem = rows.find((r) => r.type === 'item' && r.value === 'Homebrew Widget')
    expect(customItem.groupKey).toBe('__custom__')
    // A default value like D6 is NOT duplicated into the custom group.
    expect(rows.filter((r) => r.type === 'item' && r.value === 'D6')).toHaveLength(1)
  })

  describe('groupsFromManaged', () => {
    it('groups managed rows and orders Dice → Cards → Other → Custom', () => {
      const groups = groupsFromManaged([
        { name: 'Poker Chips', group: 'Other' },
        { name: 'D20', group: 'Dice' },
        { name: 'Tarot Cards', group: 'Cards' },
        { name: 'My Widget', group: 'Custom' },
      ])
      expect(groups.map((g) => g.label)).toEqual(['Dice', 'Cards', 'Other', 'Custom'])
      expect(groups[0].items).toEqual(['D20'])
    })

    it('places unknown groups after the canonical ones, alphabetically', () => {
      const groups = groupsFromManaged([
        { name: 'Zeta', group: 'Zeta' },
        { name: 'Alpha', group: 'Alpha' },
        { name: 'D6', group: 'Dice' },
      ])
      expect(groups.map((g) => g.label)).toEqual(['Dice', 'Alpha', 'Zeta'])
    })

    it('defaults a missing group to Custom', () => {
      const groups = groupsFromManaged([{ name: 'Loose' }])
      expect(groups[0].label).toBe('Custom')
      expect(groups[0].items).toEqual(['Loose'])
    })
  })

  it('builds rows from a supplied managed group list', () => {
    const managed = groupsFromManaged([
      { name: 'D20', group: 'Dice' },
      { name: 'My Widget', group: 'Custom' },
    ])
    const rows = buildDiceMaterialRows([], 'Custom', managed)
    expect(rows.find((r) => r.type === 'item' && r.value === 'D20')).toBeTruthy()
    expect(rows.find((r) => r.type === 'item' && r.value === 'My Widget')).toBeTruthy()
    // A value not in the supplied groups is surfaced under the trailing Custom group.
    const rows2 = buildDiceMaterialRows(['Unlisted'], 'Custom', managed)
    const unlisted = rows2.find((r) => r.type === 'item' && r.value === 'Unlisted')
    expect(unlisted.groupKey).toBe('__custom__')
  })
})
