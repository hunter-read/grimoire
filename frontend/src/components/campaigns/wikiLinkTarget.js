// Parsing for the [[...]] wiki-link target syntax, plus the Trie backing the
// editor's autocomplete.
//
// A target is a mandatory title with two optional suffixes:
//
//   [[Page Title]]
//   [[Page Title:id-<page_id>]]
//   [[Page Title:#Heading]]
//   [[Page Title:id-<page_id>:#Heading]]
//
// MUST stay in lockstep with backend/routers/campaigns/wikilinks.py — if the two
// parse a target differently, an authored link resolves to different pages on
// each side (cf. issue #252, which is the same hazard for slugify).
//
// Parsing is suffix-driven and right-to-left: a trailing ":id-..." / ":#..." is
// only peeled off when it matches the strict shape, so a title containing an
// ordinary colon ("Ancient Ruins: The Depths") is untouched. The heading is
// everything after the FIRST ":#", so a heading that itself starts with "#"
// ("# # of coin") needs no escape: [[Page:## of coin]].

const ID_SUFFIX_RE = /:id-([0-9A-Za-z_-]+)$/

export const EMBED_PREFIXES = ['book:', 'map:', 'token:', 'audio:', 'file:', 'image:']

export function isEmbed(target) {
  const lower = (target || '').trim().toLowerCase()
  return EMBED_PREFIXES.some((p) => lower.startsWith(p))
}

/** Split a raw [[...]] target into { title, pageId, heading }. */
export function parseTarget(target) {
  let raw = (target || '').trim()

  let heading = null
  const hashAt = raw.indexOf(':#')
  if (hashAt !== -1) {
    heading = raw.slice(hashAt + 2).trim() || null
    raw = raw.slice(0, hashAt)
  }

  let pageId = null
  const m = ID_SUFFIX_RE.exec(raw)
  if (m) {
    pageId = m[1]
    raw = raw.slice(0, m.index)
  }

  return { title: raw.trim(), pageId, heading }
}

/** Inverse of parseTarget — assemble a target string from its parts. */
export function buildTarget(title, pageId = null, heading = null) {
  let out = (title || '').trim()
  if (pageId) out += `:id-${pageId}`
  if (heading) out += `:#${heading}`
  return out
}

// Must match the backend slugify (backend/routers/campaigns/wikilinks.py)
// exactly. Python's \w is Unicode-aware, so we use Unicode property escapes (with
// the `u` flag) instead of JS's ASCII-only \w — otherwise non-ASCII letters like
// ä/ö/ü/ß are stripped and the slug diverges (issue #252). `_` is kept here (as
// \w does) then collapsed to `-` below.
export function slugify(title) {
  return (
    (title || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\s-]/gu, '')
      .trim()
      .replace(/[\s_-]+/g, '-') || 'untitled'
  )
}

/** Case/whitespace-insensitive key for matching a :#Heading to a heading. */
export function normalizeHeading(text) {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Resolve a parsed target against the campaign's pages.
 *
 * Identity beats text: a link carrying an id resolves by id alone, so it follows
 * the page across renames and title collisions. A stale id resolves to nothing
 * rather than falling back to the title, which would silently re-point the link
 * at whatever page holds that title now (issue #287).
 */
export function resolvePage(link, pages) {
  if (!link) return null
  if (link.pageId) return pages.find((p) => p.id === link.pageId) || null
  const slug = slugify(link.title)
  return pages.find((p) => p.slug === slug || slugify(p.title) === slug) || null
}

/**
 * Pick the heading a `:#Heading` refers to, from a page's heading list.
 *
 * Ties break by level first (H1 over H2 over H3), then document order — the most
 * prominent match wins, and among equals the first one does.
 */
export function findHeading(headings, wanted) {
  const key = normalizeHeading(wanted)
  if (!key) return null
  const matches = (headings || [])
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => normalizeHeading(h.text) === key)
  if (!matches.length) return null
  matches.sort((a, b) => a.h.level - b.h.level || a.i - b.i)
  return matches[0].h
}

// --- Trie ---------------------------------------------------------------------

/**
 * Prefix tree over page titles (and their headings) for the `[[` autocomplete.
 *
 * A Trie keeps lookup proportional to the length of what the user has typed
 * rather than to the number of pages, so completion stays instant in a campaign
 * with hundreds of notes — and it walks results out in a stable order instead of
 * re-filtering and re-sorting the whole list on every keystroke.
 *
 * Entries are indexed under every word start in the title, so typing "gob"
 * surfaces "Boblin the Goblin" as well as "Goblin Camp".
 */
export class TitleTrie {
  constructor() {
    this.root = { children: new Map(), entries: [] }
    this._seq = 0
  }

  /** Index one entry under the given searchable text. */
  insert(text, entry) {
    const key = (text || '').toLowerCase().trim()
    if (!key) return
    const ranked = { ...entry, _seq: this._seq++ }
    // Index each word start so a mid-title word still matches a typed prefix.
    const starts = [0]
    for (let i = 1; i < key.length; i++) {
      if (/[\s\-_/(:,.]/.test(key[i - 1])) starts.push(i)
    }
    for (const start of starts) {
      let node = this.root
      for (let i = start; i < key.length; i++) {
        const ch = key[i]
        let next = node.children.get(ch)
        if (!next) {
          next = { children: new Map(), entries: [] }
          node.children.set(ch, next)
        }
        node = next
        // Cap the fan-out per node: with a long title we only need enough
        // candidates at each depth to fill a dropdown.
        if (node.entries.length < 64) node.entries.push(ranked)
      }
    }
  }

  /**
   * Entries whose title (or one of its words) starts with `prefix`.
   * An empty prefix returns everything, in insertion order.
   */
  search(prefix, limit = 8) {
    const key = (prefix || '').toLowerCase().trim()
    let pool
    if (!key) {
      pool = this._all()
    } else {
      let node = this.root
      for (const ch of key) {
        node = node.children.get(ch)
        if (!node) return []
      }
      pool = node.entries
    }
    // De-duplicate (an entry indexed under several word starts appears once) and
    // restore insertion order, which callers set to their preferred ranking.
    const seen = new Set()
    const out = []
    for (const e of [...pool].sort((a, b) => a._seq - b._seq)) {
      if (seen.has(e.key)) continue
      seen.add(e.key)
      out.push(e)
      if (out.length >= limit) break
    }
    return out
  }

  _all() {
    const seen = new Set()
    const out = []
    const walk = (node) => {
      for (const e of node.entries) {
        if (!seen.has(e.key)) {
          seen.add(e.key)
          out.push(e)
        }
      }
      for (const child of node.children.values()) walk(child)
    }
    walk(this.root)
    return out
  }
}

/**
 * Build the autocomplete Trie from the /wiki/titles payload.
 *
 * Emits one entry per page plus one per heading. The inserted target carries
 * `:id-` only when the page's title is ambiguous, so ordinary links stay readable
 * and ids show up exactly where they're needed to address a colliding page.
 */
export function buildTitleTrie(pages) {
  const trie = new TitleTrie()
  for (const p of pages || []) {
    const pinned = p.ambiguous ? p.id : null
    // Same-named pages are otherwise indistinguishable in the list, so an
    // ambiguous one is qualified by its immediate parent — "Ancient Ruins
    // (Northlands)". Only ambiguous entries get it; on a unique title the
    // parenthetical would be noise. A top-level page has nothing to qualify
    // with, so it keeps the bare title.
    const qualifier = p.ambiguous && p.parent_title ? ` (${p.parent_title})` : ''
    trie.insert(p.title, {
      key: `page:${p.id}`,
      label: `${p.title}${qualifier}`,
      detail: null,
      target: buildTarget(p.title, pinned, null),
      pageId: p.id,
    })
    for (const h of p.headings || []) {
      trie.insert(`${p.title} ${h.text}`, {
        key: `head:${p.id}:${h.level}:${h.text}`,
        label: `${p.title}${qualifier} › ${h.text}`,
        detail: `H${h.level}`,
        target: buildTarget(p.title, pinned, h.text),
        pageId: p.id,
      })
    }
  }
  return trie
}
