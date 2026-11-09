/**
 * The armory: wargame books, kept in the library's `armory/` folder beside
 * `books/`. Its systems and books carry `game_type: 'wargame'`; everything
 * under `books/` is `'ttrpg'`. The two share one set of views - the Armory is
 * the library view over the other game type - so the only difference a link
 * needs is which section it opens in.
 */

export type GameType = 'ttrpg' | 'wargame'

/** The route a game type's shelves live under: `/library` or `/armory`. */
export function libraryBase(gameType?: string | null): '/library' | '/armory' {
  return gameType === 'wargame' ? '/armory' : '/library'
}

/** A system's shelf, in the section its game type belongs to. */
export function systemPath(system: { id: string; game_type?: string | null }): string {
  return `${libraryBase(system.game_type)}/system/${system.id}`
}

/**
 * Whether the sidebar lists the Armory. Once it holds a wargame book, for
 * everyone; before that only for admins, who are the ones to fill it. Hidden
 * for everyone when an admin switches it off.
 */
export function showArmoryNav({
  hidden,
  armoryBooks,
  isAdmin,
}: {
  hidden?: boolean | null
  armoryBooks?: number | null
  isAdmin: boolean
}): boolean {
  if (hidden) return false
  return isAdmin || (armoryBooks ?? 0) > 0
}

/**
 * Where `/` lands: the Library, or with it hidden the first shelf still listed
 * (the Armory, then maps, tokens, audio and models), or Search when every
 * shelf is hidden.
 */
export function homePath(settings: {
  hide_library?: boolean | null
  hide_armory?: boolean | null
  hide_maps?: boolean | null
  hide_tokens?: boolean | null
  hide_audio?: boolean | null
  hide_models?: boolean | null
}): string {
  if (!settings.hide_library) return '/library'
  const shelves: [string, boolean | null | undefined][] = [
    ['/armory', settings.hide_armory],
    ['/maps', settings.hide_maps],
    ['/tokens', settings.hide_tokens],
    ['/audio', settings.hide_audio],
    ['/models', settings.hide_models],
  ]
  return shelves.find(([, hidden]) => !hidden)?.[0] ?? '/search'
}
