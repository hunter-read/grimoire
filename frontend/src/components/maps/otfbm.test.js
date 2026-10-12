import { describe, it, expect } from 'vitest'
import { otfbmCommand, OTFBM_URL_PLACEHOLDER } from './otfbm'

const plan = { width: 33, height: 24, cell: 70 }

describe('otfbmCommand', () => {
  it('builds the !map command from the plan and the hosted URL', () => {
    expect(otfbmCommand(plan, 'https://example.com/tavern.jpg')).toBe(
      '!map -mapsize 33x24 -options c70 -bg https://example.com/tavern.jpg'
    )
  })

  it('stands a placeholder in for a URL not given yet', () => {
    expect(otfbmCommand(plan)).toBe(`!map -mapsize 33x24 -options c70 -bg ${OTFBM_URL_PLACEHOLDER}`)
    expect(otfbmCommand(plan, '   ')).toContain(OTFBM_URL_PLACEHOLDER)
  })

  it('trims a pasted URL', () => {
    expect(otfbmCommand(plan, '  https://x.io/a.png \n')).toMatch(/-bg https:\/\/x\.io\/a\.png$/)
  })

  it('is empty before there is a plan', () => {
    expect(otfbmCommand(null, 'https://x.io/a.png')).toBe('')
  })
})
