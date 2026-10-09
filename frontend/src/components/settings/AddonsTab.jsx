import AddonsSection from './AddonsSection'
import CodexSection from './CodexSection'
import ContentPacksSection from './ContentPacksSection'

/**
 * Admin settings tab: install and manage community add-ons (issue #203).
 *
 * Grimoire Codex comes first: it is the built-in metadata source (issue #35),
 * so it sits beside the add-on ones rather than among them.
 *
 * Add-ons are grouped by what they do rather than where they came from —
 * everything shipping today is a metadata scraper or a character content pack,
 * and future categories (VTT integrations) slot in alongside them.
 */
export default function AddonsTab() {
  return (
    <div>
      <CodexSection />
      <AddonsSection />
      <ContentPacksSection />
    </div>
  )
}
