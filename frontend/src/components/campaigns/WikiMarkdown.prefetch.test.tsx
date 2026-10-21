import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import WikiMarkdown, { MAX_PREFETCHED_EMBEDS, prefetchedBookEmbeds } from './WikiMarkdown'

const mounted = vi.fn()

// Shows the props each embed was given, so the test reads the note's choice,
// and counts mounts, so it can tell an embed re-rendered from one recreated.
vi.mock('./EmbedCard', () => ({
  default: function FakeEmbed({ spec, prefetch }: { spec: string; prefetch?: boolean }) {
    useEffect(() => mounted(spec), [spec])
    return <span data-testid="embed" data-spec={spec} data-prefetch={String(!!prefetch)} />
  },
}))

const links = (n: number) =>
  Array.from({ length: n }, (_, i) => `[[book:b${i}:${i + 1}]]`).join(' ')

describe('prefetchedBookEmbeds', () => {
  it('picks the book-page embeds, in order', () => {
    expect([...prefetchedBookEmbeds('See [[book:b1:4]] then [[ book:b2:9 ]].')]).toEqual([
      'book:b1:4',
      'book:b2:9',
    ])
  })

  it('skips book links without a page, other embeds and page links', () => {
    const body = '[[book:b1]] [[map:m1]] [[The Castle]] [[book:b2:x]] [[book:b3:7|rules]]'
    expect([...prefetchedBookEmbeds(body)]).toEqual(['book:b3:7'])
  })

  it('counts a page linked twice once', () => {
    expect([...prefetchedBookEmbeds('[[book:b1:4]] and again [[book:b1:4]]')]).toEqual([
      'book:b1:4',
    ])
  })

  it('stops at the cap, keeping the first ones', () => {
    const picked = prefetchedBookEmbeds(links(MAX_PREFETCHED_EMBEDS + 3))
    expect(picked.size).toBe(MAX_PREFETCHED_EMBEDS)
    expect(picked.has('book:b0:1')).toBe(true)
    expect(picked.has(`book:b${MAX_PREFETCHED_EMBEDS}:${MAX_PREFETCHED_EMBEDS + 1}`)).toBe(false)
  })

  it('is empty for an empty note', () => {
    expect(prefetchedBookEmbeds(null).size).toBe(0)
    expect(prefetchedBookEmbeds('').size).toBe(0)
  })
})

describe('WikiMarkdown embed prefetch', () => {
  it('prefetches the first book-page embeds and not the rest', () => {
    render(
      <MemoryRouter>
        <WikiMarkdown body={`${links(MAX_PREFETCHED_EMBEDS + 1)} [[book:solo]]`} campaignId="c1" />
      </MemoryRouter>
    )
    const flags = Object.fromEntries(
      screen.getAllByTestId('embed').map((e) => [e.dataset.spec, e.dataset.prefetch])
    )
    expect(flags['book:b0:1']).toBe('true')
    expect(flags[`book:b${MAX_PREFETCHED_EMBEDS}:${MAX_PREFETCHED_EMBEDS + 1}`]).toBe('false')
    expect(flags['book:solo']).toBe('false')
  })

  // The embeds stay mounted while the rest of the note is edited, so each
  // keeps its book rather than fetching it again on every keystroke.
  it('keeps embeds mounted while the text around them changes', () => {
    mounted.mockClear()
    // The notes view holds its page list in state, so it keeps one identity.
    const pages: never[] = []
    const note = (text: string) => (
      <MemoryRouter>
        <WikiMarkdown body={`${text} [[book:b1:4]]`} campaignId="c1" pages={pages} />
      </MemoryRouter>
    )
    const { rerender } = render(note('Rules'))
    rerender(note('Rules for'))
    rerender(note('Rules for grappling'))
    expect(mounted).toHaveBeenCalledTimes(1)
  })
})
