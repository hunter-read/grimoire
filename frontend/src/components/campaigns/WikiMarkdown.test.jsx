import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WikiMarkdown from './WikiMarkdown'

const CASTLE = { id: 'p-castle', title: 'The Castle', slug: 'the-castle' }

function renderMd(props) {
  return render(
    <MemoryRouter>
      <WikiMarkdown {...props} />
    </MemoryRouter>
  )
}

describe('WikiMarkdown', () => {
  it('renders plain markdown', () => {
    renderMd({ body: '# Hello\n\nSome **bold** text.' })
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeTruthy()
    expect(screen.getByText('bold')).toBeTruthy()
  })

  it('renders a GFM table', () => {
    renderMd({ body: '| A | B |\n|---|---|\n| 1 | 2 |' })
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('A')).toBeTruthy()
  })

  it('renders an existing [[wiki link]] as a button and calls onOpenPage', () => {
    const onOpenPage = vi.fn()
    renderMd({ body: 'Go to [[The Castle]].', pages: [CASTLE], onOpenPage })
    const link = screen.getByRole('button', { name: 'The Castle' })
    fireEvent.click(link)
    expect(onOpenPage).toHaveBeenCalledWith(CASTLE, null, expect.anything())
  })

  it('supports [[Target|label]] aliasing', () => {
    const onOpenPage = vi.fn()
    renderMd({ body: '[[The Castle|the keep]]', pages: [CASTLE], onOpenPage })
    const link = screen.getByRole('button', { name: 'the keep' })
    fireEvent.click(link)
    expect(onOpenPage).toHaveBeenCalledWith(CASTLE, null, expect.anything())
  })

  it('resolves links with German special characters (issue #252)', () => {
    // ä/ö/ü/ß must survive slugification so the link matches the backend slug,
    // which keeps Unicode letters (Python \w is Unicode-aware).
    const onOpenPage = vi.fn()
    const breit = { id: 'b1', title: 'Breitfuß', slug: 'breitfuß' }
    const zurich = { id: 'z1', title: 'Zürich Straße', slug: 'zürich-straße' }
    renderMd({
      body: 'See [[Breitfuß]] and [[Zürich Straße]].',
      pages: [breit, zurich],
      onOpenPage,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Breitfuß' }))
    expect(onOpenPage).toHaveBeenCalledWith(breit, null, expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Zürich Straße' }))
    expect(onOpenPage).toHaveBeenCalledWith(zurich, null, expect.anything())
  })

  it('escapes backslashes in link text so they cannot break out of the link', () => {
    const onOpenPage = vi.fn()
    // A trailing backslash in the label must not escape the closing bracket of
    // the markdown link we generate; the link stays intact and clickable.
    renderMd({ body: '[[The Castle|the keep\\]]', pages: [CASTLE], onOpenPage })
    const link = screen.getByRole('button', { name: /the keep/ })
    fireEvent.click(link)
    expect(onOpenPage).toHaveBeenCalledWith(CASTLE, null, expect.anything())
  })

  it('renders a missing wiki link distinctly but still clickable', () => {
    const onOpenPage = vi.fn()
    renderMd({ body: '[[Nowhere]]', pages: [], onOpenPage })
    const link = screen.getByRole('button', { name: 'Nowhere' })
    expect(link).toBeTruthy()
  })

  it('renders a ||GM secret|| as a tinted span keeping the inner text', () => {
    // The owner receives bodies that still contain ||...|| (the backend strips
    // them for everyone else); the markers are dropped and the text styled.
    renderMd({ body: 'The duke is ||a doppelganger|| in disguise.' })
    const secret = screen.getByText('a doppelganger')
    expect(secret.tagName).toBe('SPAN')
    expect(secret.getAttribute('title')).toBe('GM only — hidden from players')
    // The pipe markers themselves are not rendered.
    expect(screen.queryByText(/\|\|/)).toBeNull()
  })

  it('keeps an inline ||secret|| within its surrounding paragraph', () => {
    const { container } = renderMd({ body: 'The duke is ||a doppelganger|| in disguise.' })
    // The secret must not break the sentence into separate paragraphs.
    expect(container.querySelectorAll('p').length).toBe(1)
    expect(container.textContent).toContain('The duke is a doppelganger in disguise.')
  })

  it('renders a multiline ||GM secret|| as a tinted block keeping all its text', () => {
    const { container } = renderMd({ body: '||\nsecret text\nmore secret text\n||' })
    expect(container.textContent).toContain('secret text')
    expect(container.textContent).toContain('more secret text')
    // The pipe markers themselves are not rendered.
    expect(screen.queryByText(/\|\|/)).toBeNull()
  })

  it('renders markdown inside a multiline secret block', () => {
    const { container } = renderMd({ body: '||\n- one\n- two\n||' })
    const items = container.querySelectorAll('li')
    expect(items.length).toBe(2)
  })

  it('keeps a [[wiki link]] working when it sits next to a secret', () => {
    const onOpenPage = vi.fn()
    renderMd({
      body: '||hidden|| then [[The Castle]].',
      pages: [CASTLE],
      onOpenPage,
    })
    fireEvent.click(screen.getByRole('button', { name: 'The Castle' }))
    expect(onOpenPage).toHaveBeenCalledWith(CASTLE, null, expect.anything())
    expect(screen.getByText('hidden').tagName).toBe('SPAN')
  })

  it('resolves a pinned [[Title:id-...]] to that page, not the title match', () => {
    // The colliding page is unreachable by title alone; the id gets there.
    const onOpenPage = vi.fn()
    const first = { id: 'p1', title: 'Ancient Ruins', slug: 'ancient-ruins' }
    const second = { id: 'p2', title: 'ancient ruins', slug: 'ancient-ruins-2' }
    renderMd({
      body: 'Go to [[Ancient Ruins:id-p2]].',
      pages: [first, second],
      onOpenPage,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ancient Ruins' }))
    expect(onOpenPage).toHaveBeenCalledWith(second, null, expect.anything())
  })

  it('follows the id when the link text has gone stale after a rename', () => {
    const onOpenPage = vi.fn()
    const renamed = { id: 'p1', title: 'New Keep', slug: 'new-keep' }
    renderMd({ body: '[[Old Keep:id-p1]]', pages: [renamed], onOpenPage })
    fireEvent.click(screen.getByRole('button', { name: 'Old Keep' }))
    expect(onOpenPage).toHaveBeenCalledWith(renamed, null, expect.anything())
  })

  it('renders a pinned link to a deleted page as broken', () => {
    renderMd({ body: '[[Gone:id-missing]]', pages: [] })
    const link = screen.getByRole('button', { name: 'Gone' })
    expect(link.getAttribute('title')).toBe('This link points to a page that no longer exists.')
  })

  it('hides the :id- and :#Heading suffixes from the rendered link text', () => {
    renderMd({ body: '[[The Castle:id-p1:#Loot]]', pages: [CASTLE] })
    expect(screen.getByRole('button', { name: 'The Castle' })).toBeTruthy()
  })

  it('passes a :#Heading through to onOpenPage for a cross-page link', () => {
    const onOpenPage = vi.fn()
    renderMd({ body: '[[The Castle:#Loot]]', pages: [CASTLE], onOpenPage })
    fireEvent.click(screen.getByRole('button', { name: 'The Castle' }))
    expect(onOpenPage).toHaveBeenCalledWith(CASTLE, 'Loot', expect.anything())
  })

  it('does not navigate for a heading link to the page already open', () => {
    // Same-page heading links scroll in place instead of re-opening the page.
    const onOpenPage = vi.fn()
    renderMd({
      body: '# Loot\n\n[[The Castle:#Loot]]',
      pages: [CASTLE],
      currentPageId: CASTLE.id,
      onOpenPage,
    })
    fireEvent.click(screen.getByRole('button', { name: 'The Castle' }))
    expect(onOpenPage).not.toHaveBeenCalled()
  })

  it('gives headings an anchor id so :#Heading links can reach them', () => {
    const { container } = renderMd({ body: '# Loot\n\n## Deep Loot' })
    const ids = [...container.querySelectorAll('h1,h2')].map((h) => h.id)
    expect(ids).toEqual(['wiki-h-loot', 'wiki-h-deep%20loot'])
  })

  it('keeps a title containing a colon working as a plain link', () => {
    const onOpenPage = vi.fn()
    const page = { id: 'p9', title: 'Ruins: The Depths', slug: 'ruins-the-depths' }
    renderMd({ body: '[[Ruins: The Depths]]', pages: [page], onOpenPage })
    fireEvent.click(screen.getByRole('button', { name: 'Ruins: The Depths' }))
    expect(onOpenPage).toHaveBeenCalledWith(page, null, expect.anything())
  })

  it('renders a Grimoire embed as a content button, not a wiki link', () => {
    renderMd({ body: 'See [[book:abc123:5]] here.' })
    // Embed renders a labeled button; no stub wiki link created.
    expect(screen.getByRole('button')).toBeTruthy()
  })

  it('renders an [[image:ID]] embed as an inline image when given a campaign id', () => {
    const { container } = renderMd({ body: '[[image:img789]]', campaignId: 'camp1' })
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    // The src points at the campaign file endpoint for that image.
    expect(img.getAttribute('src')).toContain('/campaigns/camp1/files/img789')
  })

  it('renders a [[file:ID]] embed as a clickable download card', () => {
    renderMd({ body: '[[file:doc555]]', campaignId: 'camp1' })
    // A file embed is a button (opens the file), not an inline image.
    expect(screen.getByRole('button')).toBeTruthy()
  })

  // List indentation is styling (index.css scopes it to .wiki-markdown, since the
  // global `*` reset zeroes list padding). jsdom doesn't load that stylesheet, so
  // these lock in the markup contract those rules hang off instead.
  it('wraps rendered markdown in the .wiki-markdown scope the list styles target', () => {
    const { container } = renderMd({ body: '- one\n- two' })
    const scope = container.querySelector('.wiki-markdown')
    expect(scope).toBeTruthy()
    expect(scope.querySelector('ul')).toBeTruthy()
  })

  it('nests a sub-list inside its parent list item', () => {
    const { container } = renderMd({ body: '- one\n  - nested\n- two' })
    const top = container.querySelector('.wiki-markdown > ul')
    expect(top.children).toHaveLength(2)
    // The nested <ul> lives inside the first <li>, so `li > ul` indents it.
    expect(top.children[0].querySelector('ul')).toBeTruthy()
    expect(screen.getByText('nested')).toBeTruthy()
  })

  it('renders an ordered list as <ol>', () => {
    const { container } = renderMd({ body: '1. first\n2. second' })
    const ol = container.querySelector('.wiki-markdown ol')
    expect(ol).toBeTruthy()
    expect(ol.children).toHaveLength(2)
  })

  it('tags task-list items so the bullet can be suppressed', () => {
    const { container } = renderMd({ body: '- [ ] todo\n- [x] done' })
    const items = container.querySelectorAll('li.task-list-item')
    expect(items).toHaveLength(2)
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
  })

  it('keeps lists indented inside a multiline GM secret block', () => {
    const { container } = renderMd({ body: '||Secret:\n\n- hidden one\n- hidden two||' })
    // The secret block renders its own WikiMarkdown pass, still under the scope.
    expect(container.querySelector('.wiki-markdown ul')).toBeTruthy()
    expect(screen.getByText('hidden one')).toBeTruthy()
  })
})
