import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { campaigns as campaignsApi } from '../../../api'
import Spinner from '../../Spinner'

/**
 * Where a finished token goes: onto a character, or into a campaign's resources.
 *
 * Step one splits by *relationship*, not by destination:
 *
 *  - **Send to a character** — the games the viewer plays in. One row per
 *    character, because a player has one character per campaign and naming the
 *    character is more use than naming the game.
 *  - **Send to a campaign you GM** — one row per campaign, never per character.
 *    A GM with four campaigns has every player's character to choose from, and
 *    listing them all up front buries the four campaigns under twenty
 *    characters. Choosing a campaign narrows to it first.
 *
 * A GM's second step then offers "set as a character token" alongside the
 * resource categories, and picking that leads to a third step listing only that
 * campaign's characters. So the characters a GM can reach are never more than
 * one campaign's worth at a time.
 *
 * Both paths mirror the server: character rows match `_assert_can_edit_member`
 * (the member themselves or the campaign owner), and the GM list matches
 * `assert_can_manage`. A viewer with neither relationship sees neither list —
 * anything offered here must be something the server will actually accept.
 */
export default function SendToCampaignDialog({
  userId,
  onClose,
  onChooseMember,
  onChooseCampaign,
}) {
  const { t } = useTranslation()
  // Characters in games the viewer *plays* — their own membership only.
  const [playing, setPlaying] = useState(null)
  // Campaigns the viewer owns, each carrying its own member rows for step three.
  const [owned, setOwned] = useState([])
  const [error, setError] = useState('')
  // The campaign a GM has drilled into, and whether they are picking a character
  // within it rather than a category.
  const [target, setTarget] = useState(null)
  const [pickingCharacter, setPickingCharacter] = useState(false)
  const [categories, setCategories] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // `/campaigns` answers with a bare array, not a `{campaigns}` wrapper.
        const list = await campaignsApi.list()
        const summaries = Array.isArray(list) ? list : list?.campaigns || []
        const playingRows = []
        const ownedRows = []
        // The list payload carries only light member rows, so each campaign is
        // fetched for the membership ids the token endpoint is keyed by.
        for (const summary of summaries) {
          const detail = await campaignsApi.get(summary.id)
          const row = (m) => ({
            campaignId: detail.id,
            campaignName: detail.name,
            memberId: m.id,
            memberName: m.character_name || m.display_name || m.username,
          })
          // The synthetic owner row has no membership id to key an upload by.
          const membersWithIds = (detail.members || []).filter((m) => m.id)

          if (detail.owner_id === userId) {
            ownedRows.push({
              id: detail.id,
              name: detail.name,
              members: membersWithIds.map(row),
            })
            continue
          }
          // A game they play in: only their own character is theirs to set.
          const mine = membersWithIds.find((m) => m.user_id === userId)
          if (mine) playingRows.push(row(mine))
        }
        if (!cancelled) {
          setPlaying(playingRows)
          setOwned(ownedRows)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || t('tokenEditor.campaignsFailed'))
          setPlaying([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, t])

  // Categories are per-campaign, so they load only once a GM has chosen one.
  useEffect(() => {
    if (!target) return undefined
    let cancelled = false
    setCategories(null)
    campaignsApi
      .listCategories(target.id, 'resource')
      .then((data) => {
        // The endpoint returns a bare array of categories.
        if (!cancelled) setCategories(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        // A campaign with no categories is the normal case, not an error: the
        // token then lands in the built-in Tokens group.
        if (!cancelled) setCategories([])
      })
    return () => {
      cancelled = true
    }
  }, [target])

  const goBack = () => {
    if (pickingCharacter) {
      setPickingCharacter(false)
      return
    }
    setTarget(null)
  }

  // Escape steps back through the flow before it closes, so a GM three levels
  // in does not lose the whole dialog to one keystroke. Handled on the panel
  // rather than window — the same reasoning as the file-manager modals: a window
  // listener would also catch keystrokes bubbling from whatever is behind this.
  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    if (target) {
      goBack()
      return
    }
    onClose()
  }

  const loading = playing === null
  const nothingOffered = !loading && playing.length === 0 && owned.length === 0

  const heading = () => {
    if (pickingCharacter) return t('tokenEditor.chooseCharacter')
    if (target) return t('tokenEditor.chooseCategory')
    return t('tokenEditor.sendToCampaign')
  }

  const subheading = () => {
    if (pickingCharacter) return t('tokenEditor.chooseCharacterHint', { name: target.name })
    if (target) return t('tokenEditor.chooseCategoryHint', { name: target.name })
    return t('tokenEditor.sendToCampaignHint')
  }

  return (
    <div style={backdrop} onClick={onClose}>
      <div
        style={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('tokenEditor.sendToCampaign')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{heading()}</h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.5 }}>
          {subheading()}
        </p>

        {loading && (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <Spinner size={20} />
          </div>
        )}

        {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}

        {nothingOffered && !error && (
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t('tokenEditor.noCampaigns')}</p>
        )}

        {/* Step three: the characters in the one campaign a GM drilled into. */}
        {target && pickingCharacter && (
          <div style={listStyle}>
            {target.members.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {t('tokenEditor.noCharacters')}
              </p>
            ) : (
              target.members.map((option) => (
                <button
                  key={option.memberId}
                  type="button"
                  onClick={() => onChooseMember(option)}
                  style={rowStyle}
                >
                  <div style={rowTitle}>{option.memberName}</div>
                </button>
              ))
            )}
          </div>
        )}

        {/* Step two: what a GM is doing with the token in this campaign — a
            character's token, or a resource filed under a category. */}
        {target && !pickingCharacter && (
          <div style={listStyle}>
            {categories === null ? (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <Spinner size={20} />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setPickingCharacter(true)}
                  style={rowStyle}
                  disabled={target.members.length === 0}
                >
                  <div style={rowTitle}>{t('tokenEditor.asCharacterToken')}</div>
                  <div style={rowSub}>
                    {target.members.length === 0
                      ? t('tokenEditor.noCharacters')
                      : t('tokenEditor.pickCharacterNext')}
                  </div>
                </button>

                <div style={dividerStyle} />

                <button
                  type="button"
                  onClick={() => onChooseCampaign({ campaignId: target.id, categoryId: null })}
                  style={rowStyle}
                >
                  <div style={rowTitle}>{t('tokenEditor.defaultCategory')}</div>
                  <div style={rowSub}>{t('tokenEditor.defaultCategoryHint')}</div>
                </button>
                {categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() =>
                      onChooseCampaign({ campaignId: target.id, categoryId: category.id })
                    }
                    style={rowStyle}
                  >
                    <div style={rowTitle}>{category.name}</div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* Step one: the two relationships, never mixed. */}
        {!target && !loading && (
          <div style={listStyle}>
            {playing.length > 0 && (
              <>
                <div style={sectionLabel}>{t('tokenEditor.sendToCharacter')}</div>
                {playing.map((option) => (
                  <button
                    key={option.memberId}
                    type="button"
                    onClick={() => onChooseMember(option)}
                    style={rowStyle}
                  >
                    <div style={rowTitle}>{option.memberName}</div>
                    <div style={rowSub}>{option.campaignName}</div>
                  </button>
                ))}
              </>
            )}

            {owned.length > 0 && (
              <>
                <div style={sectionLabel}>{t('tokenEditor.sendToOwnedCampaign')}</div>
                {owned.map((campaign) => (
                  <button
                    key={campaign.id}
                    type="button"
                    onClick={() => setTarget(campaign)}
                    style={rowStyle}
                  >
                    <div style={rowTitle}>{campaign.name}</div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          {target && (
            <button type="button" onClick={goBack} style={btn}>
              {t('common.back')}
            </button>
          )}
          <button type="button" onClick={onClose} style={btn}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

const listStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 320,
  overflowY: 'auto',
}

const sectionLabel = {
  fontSize: 11,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginTop: 4,
}

// Separates the character route from the resource categories below it: the two
// do genuinely different things with the token.
const dividerStyle = {
  borderTop: '1px solid var(--border)',
  margin: '4px 0',
}

const rowStyle = {
  textAlign: 'left',
  padding: '8px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
}

const rowTitle = { fontSize: 13, fontWeight: 600 }
const rowSub = { fontSize: 11, color: 'var(--text-dim)' }

const backdrop = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 20,
}

const panel = {
  width: '100%',
  maxWidth: 420,
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 20,
}

const btn = {
  padding: '8px 16px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
}
