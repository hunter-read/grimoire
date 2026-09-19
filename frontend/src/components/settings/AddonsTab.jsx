import AddonsSection from './AddonsSection'
import ContentPacksSection from './ContentPacksSection'

/**
 * Admin settings tab: install and manage community add-ons (issue #203).
 *
 * Add-ons are grouped by what they do rather than where they came from —
 * everything shipping today is a metadata scraper or a character content pack,
 * and future categories (VTT integrations) slot in alongside them.
 */
export default function AddonsTab() {
  return (
    <div>
      <AddonsSection />
      <ContentPacksSection />
    </div>
  )
}
