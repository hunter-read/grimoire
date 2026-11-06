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

/**
 * Render a diagram to an SVG string.
 *
 * `securityLevel: 'strict'` is Mermaid's default, set explicitly so it can't
 * drift: label HTML is sanitised and `click` callbacks are disabled. Wiki text
 * is user-authored and shown to other campaign members, so never loosen it.
 *
 * Parses first, which throws on a bad diagram without touching the DOM -
 * `render` on invalid input leaves an error graphic behind in <body>.
 */
export async function renderMermaid(id: string, source: string, theme: MermaidTheme) {
  const { default: mermaid } = await import('mermaid')
  // Global, but every diagram on a page shares the one app theme, and Mermaid
  // queues renders itself.
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
  await mermaid.parse(source)
  const { svg } = await mermaid.render(id, source)
  return svg
}
