import { describe, it, expect } from 'vitest'
import { productCodeFromFilename } from './productCode'

describe('productCodeFromFilename', () => {
  it.each([
    ['PZO9001 Bestiary.pdf', 'PZO9001'],
    ['PZO2102E - Bestiary.pdf', 'PZO2102E'],
    ['pzo1110_core.pdf', 'PZO1110'],
    ['DDAL05-01 Treasure of the Broken Hoard.pdf', 'DDAL05-01'],
    ['DDEX1-1 Defiance in Phlan.pdf', 'DDEX1-1'],
    ['DDAL-DRW01 Episode.pdf', 'DDAL-DRW01'],
    ['TSR 9247 Castle Greyhawk.pdf', 'TSR 9247'],
    ['TSR_9247.pdf', 'TSR 9247'],
    ['CAT35000 Technical Readout 3025.pdf', 'CAT35000'],
    ['BattleTech (CAT 35130A).pdf', 'CAT 35130A'],
    ['Map ZF 1234 56789.pdf', 'ZF 1234 56789'],
    ['S1-01 Silent Tide.pdf', 'S1-01'],
  ])('reads %s', (name, code) => {
    expect(productCodeFromFilename(name)).toBe(code)
  })

  it.each([
    'Bestiary 1 (2nd Printing).pdf',
    'Players Handbook 2014.pdf',
    'XPZO9001.pdf',
    'PZO9001X9.pdf',
    'chapters s1-01.pdf',
    '',
    undefined,
  ])('finds nothing in %s', (name) => {
    expect(productCodeFromFilename(name)).toBe('')
  })

  it('takes the leftmost code when several match', () => {
    expect(productCodeFromFilename('TSR 9247 reprint PZO9001.pdf')).toBe('TSR 9247')
    expect(productCodeFromFilename('PZO9001 was TSR 9247.pdf')).toBe('PZO9001')
  })
})
