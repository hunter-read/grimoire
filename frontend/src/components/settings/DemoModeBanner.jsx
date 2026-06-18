import { useTranslation } from 'react-i18next'

/** Notice shown to non-admin accounts when the server runs in demo mode. */
export default function DemoModeBanner() {
  const { t } = useTranslation()
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        background: 'rgba(200,160,60,0.1)',
        border: '1px solid var(--gold-dim)',
        fontSize: 14,
        color: 'var(--text-dim)',
        lineHeight: 1.6,
      }}
    >
      {t('userSettings.demoMode.notice')}
    </div>
  )
}
