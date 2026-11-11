import { useTranslation } from 'react-i18next'
import LazyImg from '../../LazyImg'

/**
 * The map a page shows, drawn whole above the page's text while it is being
 * written - so the description can be written looking at the map it describes.
 * Pins are placed on the page itself, not here.
 */
export default function MapPreview({ src, name }: { src: string; name?: string | null }) {
  const { t } = useTranslation()
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <LazyImg
        // Keyed so a replaced map is a fresh image, not the old one until it loads.
        key={src}
        eager
        src={src}
        alt={name ? t('wikiMap.previewAlt', { name }) : t('wikiMap.previewAltUnnamed')}
        style={{
          display: 'block',
          maxWidth: '100%',
          maxHeight: '32vh',
          objectFit: 'contain',
        }}
      />
    </div>
  )
}
