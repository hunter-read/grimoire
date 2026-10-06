import { useState, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFileText, LuBookOpen } from 'react-icons/lu'
import SheetsTab from './SheetsTab'
import RulesetsPanel from './RulesetsPanel'
import SheetCatalogue from './SheetCatalogue'
import CharacterDialog from './CharacterDialog'
import { tabList, tabBtn } from './characterStyles'

const TABS = [
  { key: 'sheets', icon: LuFileText, label: 'characters.manageSheetsTab' },
  { key: 'content', icon: LuBookOpen, label: 'characters.contentTab' },
]

/**
 * One place to manage everything a character is built from.
 *
 * Sheets describe a character; content - installed content packs and the
 * rulesets a table edits - is what it picks from. They are one job, so they
 * are one dialog with a tab each.
 */
export default function SheetManager({ schemas, onChanged, onClose, initialTab = 'sheets' }) {
  const { t } = useTranslation()
  const baseId = useId()
  const tabRefs = useRef({})
  const [tab, setTab] = useState(initialTab === 'rulesets' ? 'content' : initialTab)
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState('')

  // Left and right move between tabs, as a tab list should.
  const onTabKey = (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const index = TABS.findIndex((entry) => entry.key === tab)
    const step = event.key === 'ArrowRight' ? 1 : -1
    const next = TABS[(index + step + TABS.length) % TABS.length].key
    setTab(next)
    tabRefs.current[next]?.focus()
    event.preventDefault()
  }

  const tabs = (
    <div role="tablist" aria-label={t('characters.manageSheets')} style={tabList}>
      {TABS.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          ref={(node) => {
            tabRefs.current[key] = node
          }}
          id={`${baseId}-tab-${key}`}
          type="button"
          role="tab"
          aria-selected={tab === key}
          aria-controls={`${baseId}-panel`}
          tabIndex={tab === key ? 0 : -1}
          onClick={() => setTab(key)}
          onKeyDown={onTabKey}
          style={tabBtn(tab === key)}
        >
          <Icon size={14} aria-hidden="true" />
          {t(label)}
        </button>
      ))}
    </div>
  )

  return (
    <>
      <CharacterDialog
        title={t('characters.manageSheets')}
        // With the catalogue open over this, Escape belongs to the catalogue.
        onClose={browsing ? undefined : onClose}
        tabs={tabs}
      >
        <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${tab}`}>
          {error ? (
            <div role="alert" style={{ color: 'var(--danger)', marginBottom: 12, fontSize: 13 }}>
              {error}
            </div>
          ) : null}

          {tab === 'sheets' ? (
            <SheetsTab
              schemas={schemas}
              onChanged={onChanged}
              onBrowse={() => setBrowsing(true)}
              setError={setError}
            />
          ) : (
            <RulesetsPanel />
          )}
        </div>
      </CharacterDialog>

      {browsing ? (
        <SheetCatalogue
          onInstalled={onChanged}
          onClose={() => {
            setBrowsing(false)
            // A sheet installed from the catalogue should show in the list
            // behind it without the user closing and reopening the manager.
            onChanged?.()
          }}
        />
      ) : null}
    </>
  )
}
