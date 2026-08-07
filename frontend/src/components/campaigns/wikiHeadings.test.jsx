import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { buildHeadingComponents, childrenToText, headingDomId } from './wikiHeadings'

describe('headingDomId', () => {
  it('derives an id from the normalised heading text', () => {
    expect(headingDomId('Loot')).toBe('wiki-h-loot')
    expect(headingDomId('  The  Loot ')).toBe('wiki-h-the%20loot')
  })

  it('keeps punctuation that slugify would strip', () => {
    // "# of coin" and "of coin" are different headings and must not collide.
    expect(headingDomId('# of coin')).not.toBe(headingDomId('of coin'))
  })

  it('is stable across case and spacing differences', () => {
    expect(headingDomId('The Loot')).toBe(headingDomId('the  loot'))
  })
})

describe('childrenToText', () => {
  it('returns strings and numbers as-is', () => {
    expect(childrenToText('Loot')).toBe('Loot')
    expect(childrenToText(42)).toBe('42')
  })

  it('joins an array of children', () => {
    expect(childrenToText(['a', 'b'])).toBe('ab')
  })

  it('ignores null, undefined and booleans', () => {
    expect(childrenToText(null)).toBe('')
    expect(childrenToText(undefined)).toBe('')
    expect(childrenToText(true)).toBe('')
  })

  it('descends into nested elements', () => {
    // A heading like "## The **Loot**" arrives as nested React elements.
    expect(childrenToText(<em>Loot</em>)).toBe('Loot')
    expect(childrenToText(['The ', <strong key="s">Loot</strong>])).toBe('The Loot')
  })

  it('returns empty for an element with no children', () => {
    expect(childrenToText(<br />)).toBe('')
  })
})

describe('buildHeadingComponents', () => {
  it('gives every level an anchor id', () => {
    const c = buildHeadingComponents()
    const { container } = render(
      <div>
        <c.h1>One</c.h1>
        <c.h2>Two</c.h2>
        <c.h3>Three</c.h3>
        <c.h4>Four</c.h4>
        <c.h5>Five</c.h5>
        <c.h6>Six</c.h6>
      </div>
    )
    expect([...container.querySelectorAll('[id]')].map((el) => el.id)).toEqual([
      'wiki-h-one',
      'wiki-h-two',
      'wiki-h-three',
      'wiki-h-four',
      'wiki-h-five',
      'wiki-h-six',
    ])
  })

  it('only gives the id to the first heading of a repeated text', () => {
    // Two elements sharing an id would make getElementById ambiguous.
    const c = buildHeadingComponents()
    const { container } = render(
      <div>
        <c.h2>Loot</c.h2>
        <c.h2>Loot</c.h2>
      </div>
    )
    const [first, second] = container.querySelectorAll('h2')
    expect(first.id).toBe('wiki-h-loot')
    expect(second.id).toBe('')
  })

  it('treats case/spacing variants as the same heading', () => {
    const c = buildHeadingComponents()
    // The inner spacing is passed as a string expression: written as literal JSX
    // text, Prettier would collapse the double space and the test would no
    // longer prove whitespace is normalised.
    const { container } = render(
      <div>
        <c.h1>The Loot</c.h1>
        <c.h2>{'the  loot'}</c.h2>
      </div>
    )
    expect(container.querySelector('h1').id).toBe('wiki-h-the%20loot')
    expect(container.querySelector('h2').id).toBe('')
  })

  it('starts fresh on each call so first-wins does not leak between renders', () => {
    const first = buildHeadingComponents()
    const { container: c1 } = render(<first.h1>Loot</first.h1>)
    expect(c1.querySelector('h1').id).toBe('wiki-h-loot')
    const second = buildHeadingComponents()
    const { container: c2 } = render(<second.h1>Loot</second.h1>)
    expect(c2.querySelector('h1').id).toBe('wiki-h-loot')
  })

  it('derives the id from nested markup inside the heading', () => {
    const c = buildHeadingComponents()
    const { container } = render(
      <c.h2>
        The <em>Loot</em>
      </c.h2>
    )
    expect(container.querySelector('h2').id).toBe('wiki-h-the%20loot')
  })
})
