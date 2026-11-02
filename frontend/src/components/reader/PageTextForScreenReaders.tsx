import { useTranslation } from 'react-i18next'

export interface PageTextForScreenReadersProps {
  /** The pages on screen: one, or two in a spread. */
  pages: { page: number; text: string | undefined }[]
  totalPages: number
}

/**
 * The text of the pages on screen, laid out for a screen reader and never
 * drawn.
 *
 * A page is a picture, and the selectable word layer over it is one span per
 * word in absolute positions - fine for a mouse, a stutter for a screen reader.
 * This gives the same text as a heading per page and a paragraph per block, so
 * it can be read straight through or moved through by line and paragraph.
 * `undefined` text is still loading and renders nothing; an empty string means
 * the page has no text layer at all (a scan), which is worth saying.
 */
export default function PageTextForScreenReaders({
  pages,
  totalPages,
}: PageTextForScreenReadersProps) {
  const { t } = useTranslation()
  return (
    <div className="sr-only">
      {pages.map(({ page, text }) => (
        <section key={page} aria-labelledby={`reader-page-text-${page}`}>
          <h2 id={`reader-page-text-${page}`}>
            {t('a11y.readingProgress', { page, total: totalPages })}
          </h2>
          {text === undefined ? null : text.trim() ? (
            paragraphs(text).map((para, i) => <p key={i}>{para}</p>)
          ) : (
            <p>{t('a11y.noPageText')}</p>
          )}
        </section>
      ))}
    </div>
  )
}

/**
 * Blank lines separate paragraphs; the single line breaks inside one are where
 * the PDF wrapped, so they become spaces and a sentence is not cut in two.
 */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
}
