import { describe, it, expect } from 'vitest'
import { smallBtn } from './memberStyles'
import { iconBtn } from './campaignEditorShared'

// Both helpers take the button's colour as an argument, and several call sites
// invoke them bare. Before issue #264 that produced `color: undefined`, which
// renders as the UA default black against the dark panels.
describe('parameterised button styles', () => {
  it('smallBtn falls back to a themed colour when called with no argument', () => {
    expect(smallBtn().color).toBe('var(--text-dim)')
  })

  it('smallBtn honours an explicit colour', () => {
    expect(smallBtn('#4caf50').color).toBe('#4caf50')
  })

  it('iconBtn falls back to a themed colour when called with no argument', () => {
    expect(iconBtn().color).toBe('var(--text-dim)')
  })

  it('iconBtn honours an explicit colour', () => {
    expect(iconBtn('var(--danger)').color).toBe('var(--danger)')
  })
})
