import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SnippetText from './SnippetText'

function renderSnippet(snippet: string | null) {
  return render(
    <p>
      <SnippetText snippet={snippet} />
    </p>
  )
}

describe('SnippetText', () => {
  it('renders nothing for an empty snippet', () => {
    const { container } = renderSnippet(null)
    expect(container.querySelector('p')).toBeEmptyDOMElement()
  })

  it('decodes the entities the server escaped, outside and inside the highlight', () => {
    // As produced by backend escape_snippet() from: it's "a" <b> & <mark>Tom's</mark>
    const { container } = renderSnippet(
      'it&#x27;s &quot;a&quot; &lt;b&gt; &amp; <mark>Tom&#x27;s</mark>'
    )
    const p = container.querySelector('p')!
    expect(p.textContent).toBe('it\'s "a" <b> & Tom\'s')
    expect(p.querySelector('mark')!.textContent).toBe("Tom's")
    expect(p.querySelector('b')).toBeNull()
  })

  it('decodes in a single pass, so an escaped entity stays literal', () => {
    const { container } = renderSnippet('&amp;lt;b&amp;gt; &amp;amp;')
    expect(container.querySelector('p')!.textContent).toBe('&lt;b&gt; &amp;')
  })
})
