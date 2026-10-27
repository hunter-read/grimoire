import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shareLinks } from '../../api'
import type { Schema } from '../../api'
import ShareLinkList from '../share/ShareLinkList'

/**
 * Your share links, across everything you have shared (issue #541). Shown even
 * after an admin takes the permission away: the links are suspended rather than
 * deleted, and this is where you see that, or take one down for good.
 */
export default function ShareLinksSection({ canShare }: { canShare?: boolean }) {
  const { t } = useTranslation()
  const [links, setLinks] = useState<Schema<'ShareLinkOut'>[] | null>(null)
  const [error, setError] = useState('')
  // null until a load fails; then the server's message, or '' for the fallback.
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    shareLinks
      .list()
      .then((data) => live && setLinks(data))
      .catch((err) => {
        if (!live) return
        setLinks([])
        setLoadError(err.message || '')
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <section>
      <h3 style={{ fontSize: 16, margin: '0 0 6px' }}>{t('userSettings.shareLinks.title')}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: '0 0 14px', lineHeight: 1.6 }}>
        {canShare
          ? t('userSettings.shareLinks.description')
          : t('userSettings.shareLinks.noPermission')}
      </p>
      {(error || loadError !== null) && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 8px' }}>
          {error || loadError || t('share.loadFailed')}
        </p>
      )}
      {links === null ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('common.loading')}</p>
      ) : (
        <ShareLinkList
          links={links}
          onChange={setLinks}
          onError={setError}
          emptyText={t('userSettings.shareLinks.none')}
          showItem
        />
      )}
    </section>
  )
}
