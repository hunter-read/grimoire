// How many link buttons the system header shows inline before the rest move
// into the "More" dropdown. A system can carry any number of character
// builders and general links, and laying them all out as buttons squeezed the
// title column down to a few letters per line.
export const MAX_VISIBLE_LINKS = 3

/**
 * The system's links as one list, each tagged with its kind. Character builders
 * come first. The multi-value lists are preferred; the legacy single
 * `character_builder_url` is the fallback for older data. Entries with no URL
 * are dropped.
 */
export function collectSystemLinks(system) {
  const builders = system.character_builder_urls?.length
    ? system.character_builder_urls
    : system.character_builder_url
      ? [{ label: '', url: system.character_builder_url }]
      : []
  const generic = system.urls || []
  return [
    ...builders.map((l) => ({ ...l, builder: true })),
    ...generic.map((l) => ({ ...l, builder: false })),
  ].filter((l) => l.url)
}

/**
 * Splits links into the ones shown as buttons and the ones in the overflow
 * menu, keeping each kind in its original order.
 *
 * When both kinds are present, the first of each is always visible, so a system
 * with five builders and five links still shows one of each. The remaining
 * slots go to builders first, then to links.
 */
export function splitSystemLinks(links, max = MAX_VISIBLE_LINKS) {
  if (links.length <= max) return { visible: links, overflow: [] }
  const builders = links.filter((l) => l.builder)
  const generic = links.filter((l) => !l.builder)
  let nb = builders.length ? 1 : 0
  let ng = generic.length ? 1 : 0
  let free = Math.max(0, max - nb - ng)
  const extraBuilders = Math.min(builders.length - nb, free)
  nb += extraBuilders
  free -= extraBuilders
  ng += Math.min(generic.length - ng, free)
  return {
    visible: [...builders.slice(0, nb), ...generic.slice(0, ng)],
    overflow: [...builders.slice(nb), ...generic.slice(ng)],
  }
}

/**
 * The text to show for a link: its label, or else the URL's hostname, since
 * several unlabelled links that all read "Link" are hard to tell apart.
 * `fallback` covers a URL that does not parse.
 */
export function linkText(link, fallback) {
  if (link.label) return link.label
  try {
    return new URL(link.url).hostname.replace(/^www\./, '') || fallback
  } catch {
    return fallback
  }
}
