import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { armies as armiesApi, type Schema } from '../../api'
import PublicationLinkRow from './PublicationLinkRow'
import { card, muted, sectionTitle } from './armyStyles'

interface PublicationLinksPanelProps {
  army: Schema<'ArmyDetail'>
  onChanged: () => void
}

/**
 * The publications an army cites, and which library book each opens (GMs and
 * admins). A link is shared: every army citing the publication uses it.
 */
export default function PublicationLinksPanel({ army, onChanged }: PublicationLinksPanelProps) {
  const { t } = useTranslation()
  const [items, setItems] = useState<Schema<'ArmyPublication'>[] | null>(null)

  const load = useCallback(
    () =>
      armiesApi
        .publications(army.id)
        .then(setItems)
        .catch(() => setItems([])),
    [army.id]
  )

  useEffect(() => {
    void load()
  }, [load])

  if (!items?.length) return null

  const systemName = army.system_name ?? ''
  const link = async (publication: string, bookId: string, offset: number) => {
    await armiesApi.setLink({
      system_name: systemName,
      publication,
      book_id: bookId,
      page_offset: offset,
    })
    await load()
    onChanged()
  }
  const unlink = async (publication: string) => {
    await armiesApi.removeLink(systemName, publication)
    await load()
    onChanged()
  }

  return (
    <section style={card}>
      <h3 style={{ ...sectionTitle, marginBottom: 4 }}>{t('armies.links.title')}</h3>
      <p style={{ ...muted, marginTop: 0 }}>{t('armies.links.description')}</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((item) => (
          <PublicationLinkRow key={item.publication} item={item} onLink={link} onUnlink={unlink} />
        ))}
      </ul>
    </section>
  )
}
