import { useTranslation } from 'react-i18next'

export default function Spinner({ size = 24 }) {
  const { t } = useTranslation()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ animation: 'pulse 1s infinite' }}
      role="status"
      aria-label={t('common.loading')}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="var(--gold-dim)"
        strokeWidth="2"
        strokeDasharray="31.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
