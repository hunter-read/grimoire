import { useTranslation } from 'react-i18next'
import AddonsSection from './AddonsSection'

/** Admin settings tab: install and manage community add-ons (issue #203). */
export default function AddonsTab() {
  const { t } = useTranslation()
  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{t('addons.title')}</h3>
      <p
        style={{
          fontSize: 14,
          color: 'var(--text-dim)',
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        {t('addons.description')}
      </p>
      <AddonsSection />
    </div>
  )
}
