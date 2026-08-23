import { bookPageUrl, imageSources } from '../../api'

/**
 * The page or cover image for one side of a comparison.
 *
 * Books can flip through pages, so they use the page endpoint; everything else
 * has a single thumbnail. A fixed aspect box keeps the two columns aligned even
 * when the images differ in shape — otherwise one side's taller cover would
 * push its metadata out of line with the other's, and lining the two up is the
 * whole point of the view.
 */
export default function PagePreview({ resourceType, item, page }) {
  const src =
    resourceType === 'book' && item.page_count
      ? bookPageUrl(item.id, page, 400, item.content_hash)
      : imageSources.thumbUrl(resourceType, item.id)

  if (!src) return null
  return (
    <div
      style={{
        aspectRatio: '3 / 4',
        // Tall enough to actually read a page. The comparison lives or dies on
        // being able to see the content, so the image takes the viewport height
        // it needs rather than sitting as a thumbnail beside the metadata.
        maxHeight: '68vh',
        minHeight: 340,
        background: 'var(--bg-deep)',
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <img
        src={src}
        alt={item.filename}
        loading="lazy"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  )
}
