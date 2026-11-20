import { useTranslation } from 'react-i18next'
import { LuBookMarked, LuChevronDown, LuChevronRight } from 'react-icons/lu'
import type { Schema } from '../../api'
import CompendiumResultList from '../compendium/CompendiumResultList'
import { sectionHeadStyle } from './searchStyles'

export interface CompendiumSectionProps {
  results: Schema<'CompendiumSearchResult'>[]
  collapsed: boolean
  onToggle: () => void
}

// A section heading that keeps the look of the toggle inside it.
const plainHeading = { margin: 0, font: 'inherit', color: 'inherit', letterSpacing: 'normal' }

/**
 * Global search's Compendium section (issue #835): entries from the
 * compendiums of the systems the reader can see, each opening in the first
 * system it appears in.
 */
export default function CompendiumSection({
  results,
  collapsed,
  onToggle,
}: CompendiumSectionProps) {
  const { t } = useTranslation()
  if (!results.length) return null
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={plainHeading}>
        <button onClick={onToggle} aria-expanded={!collapsed} style={sectionHeadStyle}>
          {collapsed ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
          <LuBookMarked size={14} /> {t('search.compendium')}
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400 }}>
            {results.length}
          </span>
        </button>
      </h2>
      {!collapsed ? <CompendiumResultList results={results} showType showSystem /> : null}
    </section>
  )
}
