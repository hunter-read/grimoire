/**
 * The frontend's API client. Everything is imported from here (`'../api'`);
 * the modules under ./api/ split it by area.
 *
 * - `client` is typed from the backend's OpenAPI schema (issue #587): it checks
 *   a route exists for the method, its path parameters, query and body, and
 *   types what it resolves to. The helpers below are built on it.
 * - The default export is the raw transport (`api.get(url)` and friends). It
 *   types a literal URL's response; a URL built at runtime resolves to
 *   `unknown`. New code should reach for `client` or a helper instead.
 *
 * Both share one transport: a JWT `Authorization` header, a single shared
 * refresh-and-retry on a 401, and `ApiError`s carrying the HTTP status.
 */
export {
  bookPageUrl,
  bookThumbUrl,
  client,
  dispositionFilename,
  mediaUrl,
  refreshAccessToken,
  urlFor,
} from './api/client'
export type {
  ApiError,
  BodyOf,
  FolderEntry,
  QueryOf,
  RequestOptions,
  ResponseOf,
  Schema,
} from './api/client'
export { campaigns } from './api/campaigns'
export { apiKeys, auth, opds, settings, shareLinks } from './api/account'
export { bulk, files, imageSources, naming, tags, tokenFrames } from './api/library'
export type { BulkType, FolderTagType } from './api/library'
export { addons, backups, duplicates, maintenance, sidecars } from './api/maintenance'
export type { DuplicateType } from './api/maintenance'
export { characters, content, contentAdmin, rulesets } from './api/characters'
export { default } from './api/client'
export { getAccessToken, setAccessToken } from './api/accessToken'
