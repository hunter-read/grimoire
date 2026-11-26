import type { ReactNode } from 'react'

/**
 * A `<g-order>`'s blocks and the order the player keeps them in.
 *
 * The order is a text field holding block keys, one per line: a fixed
 * `<g-order-item>` by its `key`, a list row by `<list>:<first column>`, a
 * catalog reference by `<list>:ref:<id>`. A second block with the same key -
 * two copies of one weapon - is `<key>#2`, a third `#3`, in layout order.
 */

/** One block: its key in the stored order, and what it draws. */
export interface OrderBlock {
  key: string
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
 * The blocks in the player's order: those the stored order does not know yet
 * first, in layout order - something new to place - then the rest as stored.
 * A key stored for a block that is gone is passed over.
 */
export function sortBlocks(blocks: OrderBlock[], stored: unknown): OrderBlock[] {
  const order = storedOrder(stored)
  const position = new Map(order.map((key, index) => [key, index]))
  const unknown = blocks.filter((block) => !position.has(block.key))
  const known = blocks
    .filter((block) => position.has(block.key))
    .sort((a, b) => position.get(a.key)! - position.get(b.key)!)
  return [...unknown, ...known]
}

/** The keys with one moved from one place to another. */
export function moveKey(keys: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= keys.length) return keys
  const next = [...keys]
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return next
}
