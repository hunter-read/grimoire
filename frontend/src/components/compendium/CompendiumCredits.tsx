import { useTranslation } from 'react-i18next'
import { LuExternalLink } from 'react-icons/lu'
import type { Schema } from '../../api'

export interface CompendiumCreditsProps {
  packs: Schema<'CompendiumPack'>[]
}

/**
 * The credit each linked pack must be shown under.
 *
 * Open game licences such as CC BY 4.0 require their attribution wherever the
 * content appears, in the exact words given, so it is rendered verbatim at
 * the foot of every compendium page rather than tucked away in settings.
 */
export default function CompendiumCredits({ packs }: CompendiumCreditsProps) {
  const { t } = useTranslation()
  const credited = packs.filter((pack) => pack.installed && (pack.attribution || pack.license))
  if (!credited.length) return null
  return (
    <footer
      aria-label={t('compendium.credits')}
      style={{
        marginTop: 32,
        paddingTop: 14,
        borderTop: '1px solid var(--border)',
        display: 'grid',
        gap: 10,
        fontSize: 12,
        color: 'var(--text-muted)',
      }}
    >
      {credited.map((pack) => (
        <div key={pack.pack_id}>
          <div style={{ color: 'var(--text-dim)', fontWeight: 600 }}>
            {pack.name}
            {pack.license ? (
              <>
                {' · '}
                {pack.license_url ? (
                  <a href={pack.license_url} target="_blank" rel="noopener noreferrer">
                    {pack.license}
                    <LuExternalLink size={10} style={{ marginLeft: 3 }} aria-hidden="true" />
                    <span className="sr-only"> {t('a11y.opensInNewTab')}</span>
                  </a>
                ) : (
                  pack.license
                )}
              </>
            ) : null}
          </div>
          {pack.attribution ? <p style={{ margin: '2px 0 0' }}>{pack.attribution}</p> : null}
        </div>
      ))}
    </footer>
  )
}
