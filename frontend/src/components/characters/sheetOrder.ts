import type { ReactNode } from 'react'

/**
 * A `<g-order>`'s blocks and the order the player keeps them in.
 *
 * The order is a text field holding block keys, one per line: a fixed
 * `<g-order-item>` by its `key`, a list row by `<list>:<first column>`, a
 * catalog reference by `<list>:ref:<id>`. A second block with the same key -
 * two copies of one weapon - is `<key>#2`, a third `#3`, in layout order.
 */

/** The most keys an order keeps for blocks it is not drawing now. */
export const MAX_HIDDEN_KEYS = 50

/** One block: its key in the stored order, who it is, and what it draws. */
export interface OrderBlock {
  key: string
  // Where the block comes from in the layout - its place there, and a row's
  // index - which stays put while its order key changes (a row renamed).
  // Drawn by this, so typing in a row's first column keeps the focus.
  id: string
  // Who the block is for a rename: `id`, and for a row the length of its list
  // too, so a row moving up into a deleted one's index is not taken for it.
  identity: string
  content: ReactNode
}

/** The keys a stored order lists, in order, each once. */
export function storedOrder(value: unknown): string[] {
  if (typeof value !== 'string') return []
  const seen = new Set<string>()
  const keys: string[] = []
  for (const line of value.split('\n')) {
    const key = line.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

/** The blocks with a repeated key told apart: `#2` on the second, and so on. */
export function withUniqueKeys(blocks: OrderBlock[]): OrderBlock[] {
  const counts = new Map<string, number>()
  return blocks.map((block) => {
    const seen = (counts.get(block.key) || 0) + 1
    counts.set(block.key, seen)
    return seen === 1 ? block : { ...block, key: `${block.key}#${seen}` }
  })
}

/**
 * The blocks in the player's order: those the order does not know yet first,
 * in layout order - something new to place - then the rest as listed.
 */
export function sortBlocks(blocks: OrderBlock[], order: string[]): OrderBlock[] {
  const position = new Map(order.map((key, index) => [key, index]))
  const unknown = blocks.filter((block) => !position.has(block.key))
  const known = blocks
    .filter((block) => position.has(block.key))
    .sort((a, b) => position.get(a.key)! - position.get(b.key)!)
  return [...unknown, ...known]
}

/**
 * The order to store: the blocks drawn, as the player arranged them, with the
 * stored keys not drawn now - a block behind a `<g-if>` that does not hold, a
 * row whose first column is briefly empty - kept each after the key it
 * followed, so the block is back in its place when it shows again. At most
 * `MAX_HIDDEN_KEYS` of those are kept, the first listed, so the keys of rows
 * deleted long ago do not pile up.
 */
export function mergeOrder(drawn: string[], stored: string[]): string[] {
  const shown = new Set(drawn)
  const result = [...drawn]
  let hidden = 0
  let after: string | null = null
  for (const key of stored) {
    if (shown.has(key)) {
      after = key
      continue
    }
    if (hidden >= MAX_HIDDEN_KEYS || result.includes(key)) continue
    hidden += 1
    result.splice(after === null ? 0 : result.indexOf(after) + 1, 0, key)
    after = key
  }
  return result
}

/** The keys with one moved from one place to another. */
export function moveKey(keys: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= keys.length) return keys
  const next = [...keys]
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return next
}

/**
 * The stored order with renamed blocks put in the place of their old keys:
 * a block whose key the order does not know, but which last stood for a key
 * the order lists and no block draws now, takes that key's place. `aliases`
 * maps a block's identity to the stored key it stood for last time; the map
 * returned is the one to keep for next time.
 */
export function renameInOrder(
  blocks: OrderBlock[],
  stored: string[],
  aliases: Map<string, string>
): { order: string[]; aliases: Map<string, string>; renamed: boolean } {
  const order = [...stored]
  const listed = new Set(stored)
  const drawn = new Set(blocks.map((block) => block.key))
  const next = new Map<string, string>()
  let renamed = false
  for (const block of blocks) {
    const old = aliases.get(block.identity)
    const at = !listed.has(block.key) && old && !drawn.has(old) ? order.indexOf(old) : -1
    if (at >= 0) {
      order[at] = block.key
      next.set(block.identity, old!)
      renamed = true
    } else {
      next.set(block.identity, block.key)
    }
  }
  return { order, aliases: next, renamed }
}
