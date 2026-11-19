/**
 * Where a system's compendium and its entries live in the app.
 *
 * The compendium is a tab of the system's page, so it shares the system's
 * route: `<system>/compendium`, a type below it, an entry below that. An
 * entry's `origin` (the pack or ruleset it came from) rides as a query
 * parameter, needed only when two entries share an id.
 */
import { libraryBase } from '../../utils/armory'

export interface CompendiumRef {
  systemId: string
  gameType?: string | null
}

export function compendiumPath({ systemId, gameType }: CompendiumRef): string {
  return `${libraryBase(gameType)}/system/${systemId}/compendium`
}

export function compendiumTypePath(ref: CompendiumRef, contentType: string): string {
  return `${compendiumPath(ref)}/${encodeURIComponent(contentType)}`
}

export function compendiumEntryPath(
  ref: CompendiumRef,
  contentType: string,
  entryId: string,
  origin?: string | null
): string {
  const path = `${compendiumTypePath(ref, contentType)}/${encodeURIComponent(entryId)}`
  return origin ? `${path}?origin=${encodeURIComponent(origin)}` : path
}
