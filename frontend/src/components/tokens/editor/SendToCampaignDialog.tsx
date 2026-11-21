import { useEffect, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { campaigns as campaignsApi, characters as charactersApi } from '../../../api'
import type { Schema } from '../../../api'
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
 * A campaign's characters come in two kinds, and both are offered (issue #949):
 *
 *  - **A player's membership** - the invited player's row on the campaign page,
 *    which has its own token slot beside its art.
 *  - **A character sheet** placed in the campaign - a GM's NPCs, or the party
 *    of a GM-only game with no invited players. A sheet has one picture, its
 *    portrait, so the token becomes that.
 *
 * Both paths mirror the server: membership rows match `_assert_can_edit_member`
 * (the member themselves or the campaign owner), sheets match the list's
 * `editable` flag (`editable_character_or_404`: the owner, or a GM let in), and
 * the GM list matches `assert_can_manage`. A viewer with no such relationship
 * sees no list - anything offered here must be something the server will
 * actually accept.
 */
type Member = Schema<'CampaignMemberOut'>
type Category = Schema<'CampaignCategoryOut'>
type Sheet = Schema<'CharacterSummary'>

/** One character a token can be sent to. */
export interface CharacterOption {
  /** A campaign membership's token, or a character sheet's portrait. */
  kind: 'member' | 'sheet'
  campaignId: string
  campaignName: string
  /** The membership id for a member, the character id for a sheet. */
  id: string
  name: string
}

/** A campaign the viewer runs, with the characters in it. */
interface OwnedCampaign {
  id: string
  name: string
  characters: CharacterOption[]
}

/** The sheets the viewer may edit, keyed by the campaign each is placed in. */
async function editableSheetsByCampaign(): Promise<Map<string, Sheet[]>> {
  const byCampaign = new Map<string, Sheet[]>()
  let sheets: Sheet[] = []
  try {
    sheets = (await charactersApi.list()).characters || []
  } catch {
    // Sheets are an extra here, not the point: a failed list leaves the
    // memberships and campaigns still on offer rather than failing the dialog.
    return byCampaign
  }
  for (const sheet of sheets) {
    if (!sheet.editable || !sheet.campaign_id) continue
    const list = byCampaign.get(sheet.campaign_id) || []
    list.push(sheet)
    byCampaign.set(sheet.campaign_id, list)
  }
  return byCampaign
}

/** A campaign, and optionally a category in it, to file the token under. */
export interface CampaignChoice {
  campaignId: string
  categoryId: string | null
}

export interface SendToCampaignDialogProps {
  userId?: string | null
  onClose: () => void
  onChooseCharacter: (option: CharacterOption) => void
  onChooseCampaign: (choice: CampaignChoice) => void
}

export default function SendToCampaignDialog({
  userId,
  onClose,
  onChooseCharacter,
  onChooseCampaign,
}: SendToCampaignDialogProps) {
  const { t } = useTranslation()
  // Characters in games the viewer *plays* - their own membership and sheets.
  const [playing, setPlaying] = useState<CharacterOption[] | null>(null)
  // Campaigns the viewer owns, each carrying its own characters for step three.
  const [owned, setOwned] = useState<OwnedCampaign[]>([])
  const [error, setError] = useState('')
  // The campaign a GM has drilled into, and whether they are picking a character
  // within it rather than a category.
  const [target, setTarget] = useState<OwnedCampaign | null>(null)
  const [pickingCharacter, setPickingCharacter] = useState(false)
  const [categories, setCategories] = useState<Category[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // `/campaigns` answers with a bare array, not a `{campaigns}` wrapper.
        const [list, sheetsByCampaign] = await Promise.all([
          campaignsApi.list(),
          editableSheetsByCampaign(),
        ])
        // A wrapped `{ campaigns }` body is tolerated as well as the bare list.
        const summaries = Array.isArray(list)
          ? list
          : (list as { campaigns?: Schema<'CampaignOut'>[] } | null)?.campaigns || []
        const playingRows: CharacterOption[] = []
        const ownedRows: OwnedCampaign[] = []
        // The list payload carries only light member rows, so each campaign is
        // fetched for the membership ids the token endpoint is keyed by.
        for (const summary of summaries) {
          const detail = await campaignsApi.get(summary.id)
          // Only members that have an id reach here; see `membersWithIds`.
          const row = (m: Member): CharacterOption => ({
            kind: 'member',
            campaignId: detail.id,
            campaignName: detail.name,
            id: m.id as string,
            name: m.character_name || m.display_name || m.username,
          })
          const sheetRow = (sheet: Sheet): CharacterOption => ({
            kind: 'sheet',
            campaignId: detail.id,
            campaignName: detail.name,
            id: sheet.id,
            name: sheet.name || t('tokenEditor.unnamedSheet'),
          })
          // The synthetic owner row has no membership id to key an upload by.
          const membersWithIds = (detail.members || []).filter((m) => m.id)
          const sheets = (sheetsByCampaign.get(detail.id) || []).map(sheetRow)

          if (detail.owner_id === userId) {
            ownedRows.push({
              id: detail.id,
              name: detail.name,
              characters: [...membersWithIds.map(row), ...sheets],
            })
            continue
          }
          // A game they play in: only their own character is theirs to set.
          const mine = membersWithIds.find((m) => m.user_id === userId)
          if (mine) playingRows.push(row(mine))
          playingRows.push(...sheets)
        }
        if (!cancelled) {
          setPlaying(playingRows)
          setOwned(ownedRows)
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || t('tokenEditor.campaignsFailed'))
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
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    if (target) {
      goBack()
      return
    }
    onClose()
  }

  // A player can hold both a membership and a sheet of the same name in one
  // campaign, so each row says which picture it replaces.
  const kindLabel = (option: CharacterOption) =>
    option.kind === 'sheet' ? t('tokenEditor.sheetPortrait') : t('tokenEditor.memberToken')

  const loading = playing === null
  const nothingOffered = !loading && playing!.length === 0 && owned.length === 0

  const heading = () => {
    if (pickingCharacter) return t('tokenEditor.chooseCharacter')
    if (target) return t('tokenEditor.chooseCategory')
    return t('tokenEditor.sendToCampaign')
  }

  const subheading = () => {
    if (pickingCharacter) return t('tokenEditor.chooseCharacterHint', { name: target!.name })
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
            {target.characters.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {t('tokenEditor.noCharacters')}
              </p>
            ) : (
              target.characters.map((option) => (
                <button
                  key={`${option.kind}:${option.id}`}
                  type="button"
                  onClick={() => onChooseCharacter(option)}
                  style={rowStyle}
                >
                  <div style={rowTitle}>{option.name}</div>
                  <div style={rowSub}>{kindLabel(option)}</div>
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
                  disabled={target.characters.length === 0}
                >
                  <div style={rowTitle}>{t('tokenEditor.asCharacterToken')}</div>
                  <div style={rowSub}>
                    {target.characters.length === 0
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
            {playing!.length > 0 && (
              <>
                <div style={sectionLabel}>{t('tokenEditor.sendToCharacter')}</div>
                {playing!.map((option) => (
                  <button
                    key={`${option.kind}:${option.id}`}
                    type="button"
                    onClick={() => onChooseCharacter(option)}
                    style={rowStyle}
                  >
                    <div style={rowTitle}>{option.name}</div>
                    <div style={rowSub}>
                      {option.campaignName} · {kindLabel(option)}
                    </div>
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

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 320,
  overflowY: 'auto',
}

const sectionLabel: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginTop: 4,
}

// Separates the character route from the resource categories below it: the two
// do genuinely different things with the token.
const dividerStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  margin: '4px 0',
}

const rowStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
}

const rowTitle: CSSProperties = { fontSize: 13, fontWeight: 600 }
const rowSub: CSSProperties = { fontSize: 11, color: 'var(--text-dim)' }

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 20,
}

const panel: CSSProperties = {
  width: '100%',
  maxWidth: 420,
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 20,
}

const btn: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
}
