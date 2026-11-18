import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import LazyImg from '../LazyImg'
import ImageLightbox from './ImageLightbox'

/** An image embed: inline in the note, full screen on a click. */
export default function EmbedImage({ src }: { src: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('wiki.embed_imageOpen')}
        title={t('wiki.embed_imageOpen')}
        style={{
          display: 'block',
          maxWidth: '100%',
          margin: '8px 0',
          padding: 0,
          border: 'none',
          background: 'none',
          cursor: 'zoom-in',
        }}
      >
        <LazyImg src={src} alt="" style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }} />
      </button>
      {open && <ImageLightbox src={src} onClose={() => setOpen(false)} />}
    </>
  )
}
