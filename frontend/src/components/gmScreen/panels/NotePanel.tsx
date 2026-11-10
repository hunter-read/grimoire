import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuExternalLink } from 'react-icons/lu'
import { campaigns, type ResponseOf } from '../../../api'
import Spinner from '../../Spinner'
import WikiMarkdown from '../../campaigns/WikiMarkdown'
import { useGmScreenContext } from '../gmScreenContext'
import useWikiTitles from '../useWikiTitles'
import type { PanelBodyProps } from './panelProps'

type Page = ResponseOf<'/campaigns/{campaign_id}/wiki/{page_id}', 'get'>

/**
 * A campaign note pinned to the board - the session's plan, a list of names,
 * the rules for a strange room. It reads as it does in the notes, GM secrets
 * included, and a link in it opens the note it names.
 */
export default function NotePanel({ panel }: PanelBodyProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { campaignId } = useGmScreenContext()
  const titles = useWikiTitles(campaignId)
  const pageId = typeof panel.config.page_id === 'string' ? panel.config.page_id : null
  const [page, setPage] = useState<Page | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPage(null)
    setMissing(false)
    if (!pageId) return
    campaigns
      .getWikiPage(campaignId, pageId)
      .then((loaded) => {
        if (!cancelled) setPage(loaded)
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })
    return () => {
      cancelled = true
    }
  }, [campaignId, pageId])

  if (!pageId || missing) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {missing ? t('gmScreen.note.missing') : t('gmScreen.note.choose')}
      </p>
    )
  }
  if (!page) return <Spinner size={18} />

  const notesUrl = (id: string) => `/campaigns/${campaignId}/notes?note=${encodeURIComponent(id)}`
  return (
    <div style={{ fontSize: 14 }}>
      <Link
        to={notesUrl(page.id)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
          color: 'var(--gold)',
        }}
      >
        <LuExternalLink size={12} aria-hidden="true" />{' '}
        {t('gmScreen.note.open', { title: page.title })}
      </Link>
      <WikiMarkdown
        body={page.body}
        campaignId={campaignId}
        pages={titles}
        currentPageId={page.id}
        headingLevelOffset={2}
        onOpenPage={(target) => target && navigate(notesUrl(target.id))}
      />
    </div>
  )
}
