import { useTranslation } from 'react-i18next'

export interface SavedAnnouncementProps {
  saved: boolean
}

/**
 * Says "Saved" to a screen reader when a setting's change lands.
 *
 * The green tick the sections draw says nothing to one: an icon is hidden from
 * assistive tech, and the tick sits inside a label or heading, where spoken
 * text would become part of the field's name. So the news goes here instead,
 * beside it: a polite region that is always mounted, so only its words change
 * - a region that appears already holding its text is often not announced.
 */
export default function SavedAnnouncement({ saved }: SavedAnnouncementProps) {
  const { t } = useTranslation()
  return (
    <span role="status" className="sr-only">
      {saved ? t('common.saved') : ''}
    </span>
  )
}
