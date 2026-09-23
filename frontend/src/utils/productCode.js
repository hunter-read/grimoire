// Publisher product codes (catalogue number / SKU) recognised in file names
// (issue #479). Deliberately a short list of publisher-specific shapes rather
// than anything generic: a pattern loose enough to catch every code would also
// catch page ranges, years and version numbers, and a wrong code filled in
// across a whole selection is worse than an empty one.
//
// Codes are bounded by anything that is not a letter or digit rather than by
// `\b`, because `_` is a word character and "PZO9001_Bestiary.pdf" is exactly
// the kind of name these libraries are full of.
const EDGE_BEFORE = '(?<![A-Za-z0-9])'
const EDGE_AFTER = '(?![A-Za-z0-9])'
const SEP = '[ _]?'

const pattern = (body, flags = 'i') => new RegExp(`${EDGE_BEFORE}(?:${body})${EDGE_AFTER}`, flags)

export const PRODUCT_CODE_PATTERNS = [
  // Paizo: PZO9001, PZO2102E, PZO1110.
  pattern(`PZO${SEP}\\d{4,5}[A-Z]{0,2}`),
  // D&D Adventurers League / Expeditions: DDAL05-01, DDEX1-1, DDAL-DRW01.
  pattern('DD(?:AL|EX)\\d{1,2}-\\d{1,2}'),
  pattern('DDAL-[A-Z]{2,5}-?\\d{1,3}'),
  // TSR module and accessory numbers: TSR 9247.
  pattern(`TSR${SEP}\\d{4,5}`),
  // Catalyst Game Labs (BattleTech, Shadowrun): CAT35000, CAT 35130A.
  pattern(`CAT${SEP}\\d{5}[A-Z]?`),
  // The ZF numbers printed on Wizards of the Coast maps: ZF 1234 56789.
  pattern(`ZF${SEP}\\d{4}${SEP}\\d{5}`),
  // Pathfinder Society scenarios: S1-01. Case-sensitive, so an ordinary
  // lower-case "s1-01" in a title does not read as a code.
  pattern('S\\d{1,2}-\\d{2}', ''),
]

/**
 * The first product code found in `name`, normalised to upper case with any
 * underscore separator turned into a space, or '' when none matches.
 * "First" means leftmost in the name, whichever pattern found it.
 */
export function productCodeFromFilename(name) {
  if (!name) return ''
  let best = null
  for (const re of PRODUCT_CODE_PATTERNS) {
    const m = re.exec(name)
    if (m && (best === null || m.index < best.index)) best = m
  }
  return best ? best[0].toUpperCase().replace(/_/g, ' ') : ''
}
