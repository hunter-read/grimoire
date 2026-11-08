import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuBookOpen } from 'react-icons/lu'
import type { Schema } from '../../api'

interface SourceRefProps {
  publication?: string
  page?: string
  /** The army's `publication_links`: which library book each publication opens. */
  links?: Record<string, Schema<'PublicationLinkOut'>>
}

/**
 * Where a unit or rule comes from - "Codex: Necrons, p. 82" - and, when that
 * publication is linked to a library book, a link opening it at the page.
 */
export default function SourceRef({ publication, page, links = {} }: SourceRefProps) {
  const { t } = useTranslation()
  if (!publication) return null
  const text = page ? t('armies.sourcePage', { publication, page }) : publication
  const link = links[publication]
  if (!link) return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{text}</span>
  const start = parseInt(page ?? '', 10)
  const target = Number.isFinite(start) ? `?page=${start + (link.page_offset ?? 0)}` : ''
  return (
    <Link
      to={`/library/book/${link.book_id}${target}`}
      title={t('armies.openSource', { title: link.book_title })}
      style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      <LuBookOpen size={12} aria-hidden="true" /> {text}
    </Link>
  )
}
