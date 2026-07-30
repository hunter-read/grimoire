import { describe, it, expect } from 'vitest'
import { prettifyCollectionName, systemDisplayName } from './systemDisplayName'

describe('prettifyCollectionName', () => {
  it('capitalizes words and replaces dashes with spaces', () => {
    expect(prettifyCollectionName('one-page-rpgs')).toBe('One Page RPGs')
  })

  it('replaces underscores too and collapses repeats', () => {
    expect(prettifyCollectionName('system__agnostic')).toBe('System Agnostic')
  })

  it('fixes up known acronyms', () => {
    expect(prettifyCollectionName('rpg')).toBe('RPG')
    expect(prettifyCollectionName('small-ttrpgs')).toBe('Small TTRPGs')
  })

  it('returns an empty string for empty input', () => {
    expect(prettifyCollectionName('')).toBe('')
    expect(prettifyCollectionName(undefined)).toBe('')
  })
})

describe('systemDisplayName', () => {
  it('prettifies one-page collection names', () => {
    expect(systemDisplayName({ name: 'one-page-rpgs', is_one_page: true })).toBe('One Page RPGs')
  })

  it('prettifies system-agnostic collection names', () => {
    expect(systemDisplayName({ name: 'system-agnostic', is_system_agnostic: true })).toBe(
      'System Agnostic'
    )
  })

  it('leaves normal system names untouched', () => {
    expect(systemDisplayName({ name: 'Dungeons & Dragons 5e' })).toBe('Dungeons & Dragons 5e')
  })

  it('returns an empty string for a missing system', () => {
    expect(systemDisplayName(null)).toBe('')
  })
})
