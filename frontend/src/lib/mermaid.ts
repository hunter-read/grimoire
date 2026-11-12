/**
 * Lazy Mermaid loading for wiki diagrams.
 *
 * Mermaid is large, and most wiki pages have no diagram, so it is imported
 * dynamically rather than bundled - the same reason `three.ts` exists. Vite
 * splits the `import()` below into its own chunks, fetched the first time a
 * page with a ```mermaid fence scrolls a diagram into view, and cached by the
 * browser after that. The main bundle is unaffected.
 */

export type MermaidTheme = 'dark' | 'default'

/** The light/dark app colour mode, as Mermaid's theme name. */
export function mermaidTheme(colorMode: string | null): MermaidTheme {
  return colorMode === 'light' ? 'default' : 'dark'
}

// Never part of a diagram Mermaid draws with labels as SVG text; a label that
// brings one in loses it.
const NOT_DRAWN = 'foreignObject, form, input, button, select, textarea, iframe, object, embed'

// Config keys a diagram can't set for itself with a `%%{init}%%` directive or a
// `config:` frontmatter block. Mermaid's own list, then what keeps labels as
// text and the styling as the app's. Mermaid applies it at every level, so
// `flowchart: { htmlLabels }` is held too.
const LOCKED_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
  'htmlLabels',
  'themeCSS',
  'themeVariables',
  'fontFamily',
]

// A path inside the app: one leading slash, not `//host` or `/\host`.
const APP_PATH = /^\/(?![/\\])/
const WEB_ADDRESS = /^https?:\/\//i

/**
 * Give the links in a rendered diagram the same treatment as links in wiki
 * text: a web address opens in a new tab with no opener or referrer, an app
 * path (`/campaigns/...`) opens in place, and anything else stops being a link.
 * Mermaid writes `click X href "..."` targets and sequence-diagram actor links
 * as SVG `<a xlink:href>`. The `<a>` itself stays, as it carries the node's
 * position.
 */
export function tidyDiagram(svg: string): string {
  const template = document.createElement('template')
  template.innerHTML = svg
  const root = template.content
  root.querySelectorAll(NOT_DRAWN).forEach((el) => el.remove())
  root.querySelectorAll('a').forEach((a) => {
    const href = (a.getAttribute('href') ?? a.getAttribute('xlink:href') ?? '').trim()
    a.removeAttribute('target')
    a.removeAttribute('rel')
    if (WEB_ADDRESS.test(href)) {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    } else if (!APP_PATH.test(href)) {
      a.removeAttribute('href')
      a.removeAttribute('xlink:href')
    }
  })
  return template.innerHTML
}

/**
 * Render a diagram to an SVG string.
 *
 * `securityLevel: 'strict'` is Mermaid's default, set explicitly so it can't
 * drift: `click` callbacks are disabled. Wiki text is user-authored and shown
 * to other campaign members, so never loosen it. Strict still lets some label
 * HTML through (images, form fields, inline styles), so labels are drawn as
 * SVG text instead (`htmlLabels: false`; the types that don't read it, such
 * as timeline and journey, already set labels as plain text). Markdown
 * strings and `<br>` still work; other tags show as written.
 * `tidyDiagram` then sees to the links.
 *
 * Parses first, which throws on a bad diagram without touching the DOM -
 * `render` on invalid input leaves an error graphic behind in <body>.
 */
export async function renderMermaid(id: string, source: string, theme: MermaidTheme) {
  const { default: mermaid } = await import('mermaid')
  // Global, but every diagram on a page shares the one app theme, and Mermaid
  // queues renders itself.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    secure: LOCKED_KEYS,
    theme,
  })
  await mermaid.parse(source)
  const { svg } = await mermaid.render(id, source)
  return tidyDiagram(svg)
}
