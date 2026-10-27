import { useTranslation } from 'react-i18next'
import { shareLinks } from '../../api'
import ShareLinkRow from './ShareLinkRow'

/**
 * A list of share links with revoke and delete wired up.
 *
 * Revoking keeps the link listed (as revoked) so its owner can see it is down;
 * only then is Delete offered, to clear it away. `onChange` receives the new
 * array after either, so the parent owns the list.
 */
export default function ShareLinkList({
  links,
  onChange,
  onError,
  emptyText,
  showItem = false,
  showOwner = false,
}) {
  const { t } = useTranslation()

  const revoke = async (link) => {
    try {
      const updated = await shareLinks.revoke(link.id)
      onChange(links.map((l) => (l.id === link.id ? { ...l, ...updated } : l)))
    } catch (err) {
      onError?.(err.message || t('share.revokeFailed'))
    }
  }

  const remove = async (link) => {
    try {
      await shareLinks.remove(link.id)
      onChange(links.filter((l) => l.id !== link.id))
    } catch (err) {
      onError?.(err.message || t('share.deleteFailed'))
    }
  }

  if (!links.length) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{emptyText}</p>
  }

  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {links.map((link) => (
        <ShareLinkRow
          key={link.id}
          link={link}
          showItem={showItem}
          showOwner={showOwner}
          onRevoke={revoke}
          onDelete={remove}
        />
      ))}
    </ul>
  )
}
