import { useTranslation } from 'react-i18next'
import { shareLinks, type Schema } from '../../api'
import ShareLinkRow from './ShareLinkRow'

type ShareLink = Schema<'ShareLinkOut'>

export interface ShareLinkListProps {
  links: ShareLink[]
  onChange: (links: ShareLink[]) => void
  onError?: (message: string) => void
  emptyText?: string
  showItem?: boolean
  showOwner?: boolean
}

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
}: ShareLinkListProps) {
  const { t } = useTranslation()

  const revoke = async (link: ShareLink) => {
    try {
      const updated = await shareLinks.revoke(link.id)
      onChange(links.map((l) => (l.id === link.id ? { ...l, ...updated } : l)))
    } catch (err) {
      onError?.((err as Error).message || t('share.revokeFailed'))
    }
  }

  const remove = async (link: ShareLink) => {
    try {
      await shareLinks.remove(link.id)
      onChange(links.filter((l) => l.id !== link.id))
    } catch (err) {
      onError?.((err as Error).message || t('share.deleteFailed'))
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
