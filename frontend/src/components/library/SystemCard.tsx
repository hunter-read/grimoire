import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuLibrary, LuCheck, LuFolderTree, LuNetwork, LuBuilding2, LuFolder } from 'react-icons/lu'
import Tag from '../Tag'
import FavoriteButton from '../FavoriteButton'
import LazyImg from '../LazyImg'
import CardLink from '../CardLink'
import { systemDisplayName } from '../../utils/systemDisplayName'
import { systemCoverUrl } from '../../utils/systemCoverUrl'

// Eyebrow badge per container kind (issues #261, #262, #301). One-page
// collections are absent on purpose: they render as chips in the Special
// Collections strip, which already identifies them.
const CONTAINER_BADGE_KEYS = {
  parent: 'systemContainer.badge',
  family: 'systemContainer.familyBadge',
  publisher: 'systemContainer.publisherBadge',
  generic: 'systemContainer.genericBadge',
}

const CONTAINER_BADGE_ICONS = {
  parent: LuFolderTree,
  family: LuNetwork,
  publisher: LuBuilding2,
  generic: LuFolder,
}

/**
 * Game-system card for the library grid. Renders one of three layouts —
 * list row, compact card, or full card — selected by the `list`/`compact` props.
 *
 * In bulk-select mode (`selectable`), clicking the card toggles its selection
 * (with shift / cmd-click modifiers) instead of navigating, and a checkbox is
 * shown. Parent containers opt out: bulk tagging and bulk edit are undefined
 * for a shelf that holds systems rather than books, so they stay plain links
 * and show no checkbox. Tag chips on the full card link to the tags page (grid
 * tag filtering is handled by the Filters modal's Tags dropdown).
 *
 * `to` is the system's route. Outside bulk-select mode the card is a real link
 * (a CardLink overlay), so middle click and ctrl/cmd-click open the system in a
 * new tab (issue #313). In bulk-select mode the card selects rather than
 * navigates, so no link is rendered.
 */
export default function SystemCard({
  system,
  to,
  compact,
  list,
  selectable = false,
  selected = false,
  onToggleSelect,
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  // Containers are stored under their raw folder slug ("one-page-rpgs"), so
  // they need prettifying; ordinary systems pass through unchanged.
  const displayName = systemDisplayName(system)
  const coverUrl = systemCoverUrl(system)
  // Container folders (issues #261, #262) hold systems rather than books of
  // their own, so their count badge reports the games nested inside. The badge
  // sits beside the title, so it uses the short form ("4 systems").
  const countLabel = system.container_kind
    ? t('systemContainer.count', { count: system.child_count || 0 })
    : t('library.bookCount', { count: system.book_count })
  // Container folders sit in the main grid alongside ordinary systems. They used
  // to be marked with a gold border, but that reads identically to the gold
  // selection border in bulk mode, so the distinction is carried by an explicit
  // badge instead — worded per kind, since "System Collection" (editions),
  // "System Family" (related systems), and "Publisher" claim different things
  // about how the children relate. One-page collections don't need it — they
  // already live in their own Special Collections strip.
  const badgeKey = CONTAINER_BADGE_KEYS[system.container_kind]
  // Bulk tag/edit have no defined meaning for a container (it owns no books), so
  // container cards never enter selection mode — they stay navigable links.
  const isSelectable = selectable && !badgeKey
  const borderColor = selected ? 'var(--gold-dim)' : 'var(--border)'

  // Selection mode owns the click (shift/cmd extend the selection); outside it
  // the CardLink overlay below handles navigation.
  const toggleSelect = isSelectable
    ? (e) => onToggleSelect?.({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
    : undefined
  const cardLink = !isSelectable && <CardLink to={to} label={displayName} />

  // An eyebrow label above the title, not a chip beside it. A chip on the
  // title's row cost a narrow card enough width to wrap the name one letter per
  // line, and gold text inside a gold chip was hard to read — bright gold
  // straight on the card background carries the same meaning with real
  // contrast, and the rule under it separates the label from the title.
  const BadgeIcon = CONTAINER_BADGE_ICONS[system.container_kind]
  const containerEyebrow = badgeKey && (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--gold-bright)',
        borderBottom: '1px solid var(--border-light)',
        paddingBottom: 6,
        marginBottom: 8,
      }}
    >
      <BadgeIcon size={12} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {t(badgeKey)}
      </span>
    </div>
  )

  const checkbox = (overlay) => (
    <div
      style={{
        ...(overlay
          ? { position: 'absolute', top: 8, left: 8, zIndex: 2 }
          : { position: 'static', flexShrink: 0 }),
        width: 20,
        height: 20,
        borderRadius: 4,
        background: selected ? 'var(--gold)' : overlay ? 'var(--bg-input)' : 'transparent',
        border: selected
          ? 'none'
          : overlay
            ? '2px solid var(--border-light)'
            : '2px solid var(--border-light)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: overlay ? '0 1px 4px var(--shadow)' : 'none',
      }}
    >
      {selected && <LuCheck size={12} color="var(--bg-deep)" strokeWidth={3} />}
    </div>
  )

  if (list) {
    return (
      <div
        onClick={toggleSelect}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 16px',
          background: selected || hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          border: `1px solid ${borderColor}`,
          borderRadius: 8,
          cursor: 'pointer',
          transition: 'background 0.15s',
          position: 'relative',
        }}
      >
        {cardLink}
        {isSelectable && checkbox(false)}
        <div
          style={{
            width: 36,
            height: 48,
            borderRadius: 4,
            overflow: 'hidden',
            flexShrink: 0,
            background: 'var(--bg-deep)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {coverUrl ? (
            <LazyImg
              src={coverUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <LuLibrary size={16} color="var(--text-muted)" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {containerEyebrow}
          <div
            style={{
              fontSize: 16,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              display: 'flex',
              gap: 8,
              marginTop: 4,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span>{countLabel}</span>
            {system.system_family && <span>· {system.system_family}</span>}
            {(system.genres || []).length > 0 && (
              <span style={{ color: 'var(--green, #5a9a5a)' }}>
                · {(system.genres || []).slice(0, 3).join(', ')}
              </span>
            )}
            {system.is_explicit && <span style={{ color: 'var(--danger)' }}>18+</span>}
          </div>
        </div>
        {!isSelectable && (
          <FavoriteButton
            type="system"
            id={system.id}
            style={{
              // Positioned (not static) so it paints above the CardLink overlay.
              position: 'relative',
              top: 'auto',
              right: 'auto',
              background: 'transparent',
              width: 28,
              height: 28,
              flexShrink: 0,
            }}
          />
        )}
      </div>
    )
  }

  if (compact) {
    return (
      <div
        onClick={toggleSelect}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: selected || hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          border: `1px solid ${borderColor}`,
          borderRadius: 8,
          cursor: 'pointer',
          transition: 'background 0.15s',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {cardLink}
        {isSelectable ? (
          checkbox(true)
        ) : (
          <FavoriteButton type="system" id={system.id} cardHovered={hovered} />
        )}
        <div
          style={{
            width: '100%',
            height: 110,
            background: 'var(--bg-deep)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {coverUrl ? (
            <LazyImg
              src={coverUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <LuLibrary size={22} color="var(--text-muted)" />
          )}
        </div>
        <div style={{ padding: '8px 10px' }}>
          {containerEyebrow}
          <div
            style={{
              fontSize: 13,
              color: 'var(--text)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </div>
          {system.is_explicit && (
            <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 2 }}>18+</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={toggleSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: selected || hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        cursor: 'pointer',
        transition: 'all 0.2s',
        transform: hovered && !isSelectable ? 'translateY(-2px)' : 'none',
        boxShadow: hovered && !isSelectable ? '0 8px 24px var(--shadow)' : 'none',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {cardLink}
      {isSelectable && checkbox(true)}
      {coverUrl ? (
        <div
          style={{
            width: '100%',
            aspectRatio: '3/4',
            maxHeight: 240,
            background: 'var(--bg-deep)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LazyImg
            src={coverUrl}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
          />
        </div>
      ) : (
        // Without art the card would be a tall empty box, so a short banner
        // keeps the grid's rhythm without pretending to be a cover.
        <div
          style={{
            width: '100%',
            height: 72,
            background: 'var(--bg-deep)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LuLibrary size={26} color="var(--text-muted)" />
        </div>
      )}

      {!isSelectable && <FavoriteButton type="system" id={system.id} cardHovered={hovered} />}
      <div style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column' }}>
        {containerEyebrow}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 8,
          }}
        >
          {/* minWidth:0 lets this flex item shrink below its longest word.
              Without it a long name next to the count badge wraps one or two
              characters per line instead of breaking at spaces. */}
          <h3
            style={{
              fontSize: 18,
              lineHeight: 1.3,
              flex: 1,
              minWidth: 0,
              overflowWrap: 'anywhere',
            }}
          >
            {displayName}
          </h3>
          <div
            style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 10 }}
          >
            {system.is_explicit && (
              <span
                style={{
                  background: 'rgba(180,60,60,0.15)',
                  border: '1px solid rgba(180,60,60,0.4)',
                  borderRadius: 20,
                  padding: '2px 8px',
                  fontSize: 11,
                  color: 'var(--danger)',
                  whiteSpace: 'nowrap',
                }}
              >
                18+
              </span>
            )}
            <span
              style={{
                background: 'var(--bg-deep)',
                borderRadius: 20,
                padding: '2px 10px',
                fontSize: 13,
                color: 'var(--text-dim)',
                whiteSpace: 'nowrap',
              }}
            >
              {countLabel}
            </span>
          </div>
        </div>

        {system.description && (
          <p
            style={{
              fontSize: 14,
              color: 'var(--text-dim)',
              marginBottom: 10,
              lineHeight: 1.5,
              fontFamily: 'Alegreya, serif',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {system.description}
          </p>
        )}

        {system.publishers?.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
            {system.publishers.map((p) => p.name).join(', ')}
          </div>
        )}

        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginTop: 'auto', paddingTop: 8 }}
        >
          {/* Genres are shown before tags (issue #202), in the genre colour.
              Genres aren't tags, so they never navigate. */}
          {(system.genres || []).slice(0, 3).map((g) => (
            <Tag key={`genre-${g}`} label={g} color="rgba(90, 154, 90, 0.2)" linkable={false} />
          ))}
          {/* Tag chips navigate to the tags page (issue #235.7); grid tag
              filtering lives in the Filters modal's Tags dropdown. */}
          {(system.tags || []).slice(0, 4).map((tag) => (
            <Tag key={tag} label={tag} />
          ))}
        </div>
      </div>
    </div>
  )
}
