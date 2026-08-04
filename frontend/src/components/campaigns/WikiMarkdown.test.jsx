import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WikiMarkdown from './WikiMarkdown'

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

  it('renders an existing [[wiki link]] as a button and calls onOpenSlug', () => {
    const onOpenSlug = vi.fn()
    renderMd({ body: 'Go to [[The Castle]].', pageSlugs: ['the-castle'], onOpenSlug })
    const link = screen.getByRole('button', { name: 'The Castle' })
    fireEvent.click(link)
    expect(onOpenSlug).toHaveBeenCalledWith('the-castle')
  })

  it('supports [[Target|label]] aliasing', () => {
    const onOpenSlug = vi.fn()
    renderMd({ body: '[[The Castle|the keep]]', pageSlugs: ['the-castle'], onOpenSlug })
    const link = screen.getByRole('button', { name: 'the keep' })
    fireEvent.click(link)
    expect(onOpenSlug).toHaveBeenCalledWith('the-castle')
  })

  it('resolves links with German special characters (issue #252)', () => {
    // ä/ö/ü/ß must survive slugification so the link matches the backend slug,
    // which keeps Unicode letters (Python \w is Unicode-aware).
    const onOpenSlug = vi.fn()
    renderMd({
      body: 'See [[Breitfuß]] and [[Zürich Straße]].',
      pageSlugs: ['breitfuß', 'zürich-straße'],
      onOpenSlug,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Breitfuß' }))
    expect(onOpenSlug).toHaveBeenCalledWith('breitfuß')
    fireEvent.click(screen.getByRole('button', { name: 'Zürich Straße' }))
    expect(onOpenSlug).toHaveBeenCalledWith('zürich-straße')
  })

  it('escapes backslashes in link text so they cannot break out of the link', () => {
    const onOpenSlug = vi.fn()
    // A trailing backslash in the label must not escape the closing bracket of
    // the markdown link we generate; the link stays intact and clickable.
    renderMd({ body: '[[The Castle|the keep\\]]', pageSlugs: ['the-castle'], onOpenSlug })
    const link = screen.getByRole('button', { name: /the keep/ })
    fireEvent.click(link)
    expect(onOpenSlug).toHaveBeenCalledWith('the-castle')
  })

  it('renders a missing wiki link distinctly but still clickable', () => {
    const onOpenSlug = vi.fn()
    renderMd({ body: '[[Nowhere]]', pageSlugs: [], onOpenSlug })
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
    const onOpenSlug = vi.fn()
    renderMd({
      body: '||hidden|| then [[The Castle]].',
      pageSlugs: ['the-castle'],
      onOpenSlug,
    })
    fireEvent.click(screen.getByRole('button', { name: 'The Castle' }))
    expect(onOpenSlug).toHaveBeenCalledWith('the-castle')
    expect(screen.getByText('hidden').tagName).toBe('SPAN')
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
