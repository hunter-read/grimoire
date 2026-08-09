import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuLibrary, LuCheck } from 'react-icons/lu'
import Tag from '../Tag'
import FavoriteButton from '../FavoriteButton'
import LazyImg from '../LazyImg'
import useLinkProps from '../../hooks/useLinkProps'
import { systemDisplayName } from '../../utils/systemDisplayName'
import { systemCoverUrl } from '../../utils/systemCoverUrl'

/**
 * Game-system card for the library grid. Renders one of three layouts —
 * list row, compact card, or full card — selected by the `list`/`compact` props.
 *
 * In bulk-select mode (`selectable`), clicking the card toggles its selection
 * (with shift / cmd-click modifiers) instead of navigating, and a checkbox is
 * shown. Tag chips on the full card link to the tags page (grid tag filtering
 * is handled by the Filters modal's Tags dropdown).
 *
 * `to` is the system's route; passing it lets middle click and ctrl/cmd-click
 * open the system in a new tab (issue #313). In bulk-select mode it is ignored,
 * since the card selects rather than navigates.
 */
export default function SystemCard({
  system,
  to,
  onClick,
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
  // Parent systems sit in the main grid alongside ordinary systems, so they get
  // a gold border to signal "this opens onto more systems". One-page collections
  // don't need it — they already live in their own Special Collections strip.
  const isParentContainer = system.container_kind === 'parent'
  const borderColor = selected
    ? 'var(--gold-dim)'
    : isParentContainer
      ? 'var(--gold)'
      : 'var(--border)'

  const handleClick = (e) => {
    if (selectable) {
      e.stopPropagation()
      onToggleSelect?.({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
      return
    }
    onClick()
  }

  // Selection mode owns the modifier keys (shift/cmd extend the selection), so
  // the card only behaves as a link when it would actually navigate.
  const linkProps = useLinkProps(selectable ? null : to, handleClick)

  const checkbox = (overlay) => (
    <div
      style={{
        ...(overlay
          ? { position: 'absolute', top: 8, left: 8, zIndex: 2 }
          : { position: 'static', flexShrink: 0 }),
        width: 20,
        height: 20,
        borderRadius: 4,
        background: selected ? 'var(--gold)' : overlay ? 'rgba(0,0,0,0.55)' : 'transparent',
        border: selected
          ? 'none'
          : overlay
            ? '2px solid rgba(255,255,255,0.45)'
            : '2px solid var(--border-light)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: overlay ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
      }}
    >
      {selected && <LuCheck size={12} color="var(--bg-deep)" strokeWidth={3} />}
    </div>
  )

  if (list) {
    return (
      <div
        {...linkProps}
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
        {selectable && checkbox(false)}
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
            {system.is_explicit && <span style={{ color: '#e07070' }}>18+</span>}
          </div>
        </div>
        {!selectable && (
          <FavoriteButton
            type="system"
            id={system.id}
            style={{
              position: 'static',
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
        {...linkProps}
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
        {selectable ? (
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
            <div style={{ fontSize: 10, color: '#e07070', marginTop: 2 }}>18+</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      {...linkProps}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: selected || hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        cursor: 'pointer',
        transition: 'all 0.2s',
        transform: hovered && !selectable ? 'translateY(-2px)' : 'none',
        boxShadow: hovered && !selectable ? '0 8px 24px rgba(0,0,0,0.3)' : 'none',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {selectable && checkbox(true)}
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

      {!selectable && <FavoriteButton type="system" id={system.id} cardHovered={hovered} />}
      <div style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column' }}>
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
                  color: '#e07070',
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
