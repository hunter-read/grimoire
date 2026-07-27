/**
 * Well-known TTRPG acronyms that should keep their canonical casing when a
 * slug/folder name is humanized for display (e.g. "gm-tools" → "GM Tools"
 * rather than "Gm Tools"). Keyed by the lowercase form.
 *
 * Also handles a few plural/possessive forms that would otherwise lose their
 * acronym casing ("gms" → "GMs").
 */
export const ACRONYMS = {
  gm: 'GM',
  gms: 'GMs',
  dm: 'DM',
  dms: 'DMs',
  pc: 'PC',
  pcs: 'PCs',
  npc: 'NPC',
  npcs: 'NPCs',
  rpg: 'RPG',
  rpgs: 'RPGs',
  ttrpg: 'TTRPG',
  ttrpgs: 'TTRPGs',
  osr: 'OSR',
  srd: 'SRD',
  ua: 'UA',
  dnd: 'DnD',
  pdf: 'PDF',
  pdfs: 'PDFs',
}

/**
 * Capitalize a single already-split word, honoring the acronym table. A leading
 * possessive like "gm's" is handled so it renders "GM's".
 */
export function capitalizeWord(word) {
  if (!word) return word
  const lower = word.toLowerCase()
  if (ACRONYMS[lower]) return ACRONYMS[lower]
  // Possessive: "gm's" → "GM's" when the stem is a known acronym.
  const possessive = lower.match(/^(.+)'s$/)
  if (possessive && ACRONYMS[possessive[1]]) return `${ACRONYMS[possessive[1]]}'s`
  return word.charAt(0).toUpperCase() + word.slice(1)
}
