import { useTranslation } from 'react-i18next'
import { fieldInput, fieldLabel } from '../../characters/characterStyles'
import type { SettingsProps } from '../GmPanelFrame'
import { useGmScreenContext } from '../gmScreenContext'
import useWikiTitles from '../useWikiTitles'

/** Which campaign note the panel shows. */
export default function NoteSettings({ config, onChange }: SettingsProps) {
  const { t } = useTranslation()
  const { campaignId } = useGmScreenContext()
  const titles = useWikiTitles(campaignId)
  const pageId = typeof config.page_id === 'string' ? config.page_id : ''
  return (
    <label style={fieldLabel}>
      {t('gmScreen.note.page')}
      <select
        value={pageId}
        onChange={(event) => {
          const page = titles.find((title) => title.id === event.target.value)
          onChange({ page_id: page?.id ?? null, page_slug: page?.slug ?? '' })
        }}
        style={fieldInput}
      >
        <option value="">{t('gmScreen.note.none')}</option>
        {titles.map((title) => (
          <option key={title.id} value={title.id}>
            {title.parent_title ? `${title.parent_title} › ${title.title}` : title.title}
          </option>
        ))}
      </select>
    </label>
  )
}
