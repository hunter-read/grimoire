import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shareLinks } from '../../api'
import ShareLinkList from '../share/ShareLinkList'

/**
 * Every share link one user has made, for the admin's user editor (issue
 * #541). The admin can revoke any of them; a link suspended because its owner
 * lost the permission is listed as such, not hidden, since it comes back if
 * the permission does.
 */
export default function UserShareLinksList({ userId }) {
  const { t } = useTranslation()
  const [links, setLinks] = useState(null)
  const [error, setError] = useState('')
  // null until a load fails; then the server's message, or '' for the fallback.
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let live = true
    shareLinks
      .listForUser(userId)
      .then((data) => live && setLinks(data))
      .catch((err) => {
        if (!live) return
        setLinks([])
        setLoadError(err.message || '')
      })
    return () => {
      live = false
    }
  }, [userId])

  if (links === null) {
    return (
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('common.loading')}</p>
    )
  }
  return (
    <>
      {(error || loadError !== null) && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 8px' }}>
          {error || loadError || t('share.loadFailed')}
        </p>
      )}
      <ShareLinkList
        links={links}
        onChange={setLinks}
        onError={setError}
        emptyText={t('users.shareLinks.none')}
        showItem
      />
    </>
  )
}
