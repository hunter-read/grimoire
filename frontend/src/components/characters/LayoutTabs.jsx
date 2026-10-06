import { useState } from 'react'
import { tabBtn } from './characterStyles'

/**
 * The pages of a sheet - `<g-tabs>` in a layout, one `<g-tab>` per page.
 *
 * A printed character sheet is several pages, and putting all of them on one
 * scrolling screen buried the second page's contents under the first's. Only
 * the chosen page is drawn; the others are not hidden, simply not rendered, so
 * a page's fields cost nothing until it is opened.
 *
 * `tabs` is `[{ title, content }]`, already filtered for any `visible_if`, so a
 * Spells page can disappear for a character who casts nothing.
 */
export default function LayoutTabs({ tabs, scope }) {
  const [active, setActive] = useState(0)
  if (!tabs.length) return null
  const current = Math.min(active, tabs.length - 1)

  return (
    <div className="gc-tabs">
      <div
        role="tablist"
        className="gc-tablist"
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 12,
        }}
      >
        {tabs.map((tab, index) => (
          <button
            key={`${scope}-tab-${index}`}
            type="button"
            role="tab"
            id={`${scope}-tab-${index}`}
            aria-selected={index === current}
            aria-controls={`${scope}-panel-${index}`}
            onClick={() => setActive(index)}
            style={tabBtn(index === current)}
          >
            {tab.title}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${scope}-panel-${current}`}
        aria-labelledby={`${scope}-tab-${current}`}
        className="gc-tabpanel"
      >
        {tabs[current].content}
      </div>
    </div>
  )
}
