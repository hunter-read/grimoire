import { useTranslation } from 'react-i18next'
import { SiGithub } from 'react-icons/si'

/**
 * "by <author>" credit for a community add-on, theme, or note template.
 *
 * One component for all three kinds so the credit renders identically wherever
 * community content is listed.
 *
 * The name itself is always plain text — it is self-declared manifest content,
 * so it never becomes the link target. When the author gave a GitHub username,
 * the server resolves it to a profile URL (`author_url`) and that is offered as
 * a separate icon beside the name, which is the only link this renders.
 *
 * Renders nothing when the manifest declares no author, which is the common
 * case for add-ons predating the field.
 */
export default function AuthorByline({ author, authorUrl }) {
  const { t } = useTranslation()
  const name = (author || '').trim()
  if (!name) return null
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <span>{t('addons.byAuthor', { author: name })}</span>
      {authorUrl && (
        <a
          href={authorUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={t('addons.githubProfile', { author: name })}
          aria-label={t('addons.githubProfile', { author: name })}
          style={{ display: 'inline-flex', alignItems: 'center', color: 'inherit' }}
        >
          <SiGithub size={12} />
        </a>
      )}
    </div>
  )
}
