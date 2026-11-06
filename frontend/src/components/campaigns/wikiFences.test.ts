import { describe, expect, it } from 'vitest'
import { maskFences, mermaidSource } from './wikiFences'

// The fence shapes here mirror TestFencedCode in
// backend/tests/test_campaign_wiki_links.py: both sides must agree.
const masked = (body: string) => maskFences(body).text

describe('maskFences', () => {
  it.each([
    ['backticks', '```mermaid\nA[[B]]\n```'],
    ['tildes', '~~~\n[[Tilde]]\n~~~'],
    ['an indented fence', '  ```js\n  [[Indented]]\n  ```'],
    ['an unclosed fence', '```\n[[Unclosed]] runs to the end'],
    ['a longer fence around a shorter one', '````\n```\n[[Nested]]\n```\n````'],
    ['a fence closed only by its own character', '```\n~~~\n[[Mixed]]\n```'],
    ['a fence in a list item', '- ```\n  [[InAList]]\n  ```'],
    ['a fence in a numbered list item', '1. ```\n   [[InANumberedList]]\n   ```'],
    ['a fence in a blockquote', '> ```\n> [[InAQuote]]\n> ```'],
  ])('masks %s', (_name, body) => {
    expect(masked(body)).not.toContain('[[')
  })

  it.each([
    ['a list-item fence', '- ```\n  code\n  ```\n\n[[Out]]'],
    ['a blockquote fence', '> ```\n> code\n> ```\n\n[[Out]]'],
    ['inline code at the start of a line', '```inline``` code\n\n[[Out]]'],
    ['backticks mid-line', 'Mid-line ``` is not a fence\n\n[[Out]]'],
  ])('never swallows what follows %s', (_name, body) => {
    expect(masked(body)).toContain('[[Out]]')
  })

  it('restores every fence exactly', () => {
    const body = 'a\n```\none\n```\nb [[x]]\n~~~\ntwo\n~~~\nc'
    const { text, restore } = maskFences(body)
    expect(text).not.toContain('one')
    expect(restore(text)).toBe(body)
  })

  it('leaves a body without fences alone', () => {
    const { text, restore } = maskFences('just [[text]]')
    expect(text).toBe('just [[text]]')
    expect(restore(text)).toBe('just [[text]]')
  })
})

describe('mermaidSource', () => {
  it('drops secret markers and keeps the text between them', () => {
    expect(mermaidSource('A --> B\n||B --> C||')).toBe('A --> B\nB --> C')
  })

  it("unescapes a player's escaped pipes", () => {
    expect(mermaidSource('A \\|\\|--o{ B : has')).toBe('A ||--o{ B : has')
  })

  it('leaves single pipes alone', () => {
    expect(mermaidSource('A -->|label| B')).toBe('A -->|label| B')
  })
})
