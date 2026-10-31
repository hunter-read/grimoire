import type {
  ApiPath,
  HttpMethod,
  JsonBody,
  Operation,
  PathsFor,
  QueryParams,
  RequestArgs,
  RequestOptions,
  SuccessBody,
  UrlResult,
} from './types'
import type { components } from './schema'
import { getAccessToken, setAccessToken } from './accessToken'

/** A schema model by name, e.g. `Schema<'CampaignOut'>`. */
export type Schema<N extends keyof components['schemas']> = components['schemas'][N]

/** An id as callers hold it: route params are strings, API payloads numbers. */
export type Id = string | number

/** What a failed request rejects with. */
export interface ApiError extends Error {
  status?: number
  body?: unknown
}

const getToken = getAccessToken

function authHeaders(includeContentType = false): Record<string, string> {
  const token = getToken()
  return {
    ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function apiError(message: string, fields: { status: number; body?: unknown }): ApiError {
  return Object.assign(new Error(message), fields)
}

// --- Access-token refresh (issue #157) -------------------------------------
// Access tokens are short-lived, so any request can come back 401 simply
// because the token aged out. When that happens we exchange the HttpOnly
// refresh cookie for a new token and replay the request once.
//
// Concurrent 401s must not each fire their own refresh: refresh tokens rotate
// on use, so parallel exchanges would invalidate each other and log the user
// out. A single in-flight promise is shared by every caller instead.
let refreshPromise: Promise<string | null> | null = null

// Requests that must never trigger a refresh: the refresh call itself (whose
// 401 is terminal) and the login-ish endpoints, where a 401 means bad
// credentials rather than a stale token.
const NO_REFRESH_PATHS = ['/auth/refresh', '/auth/login', '/auth/guest-login', '/auth/setup']

// Other tabs raise the same problem as concurrent 401s, since each holds its
// own token: two tabs refreshing at once would present the same refresh cookie twice, and the
// second use reads as a replay that ends the session. The Web Locks API
// serialises them, so a waiting tab refreshes with the cookie the first one
// just received. Where it is missing (old browsers, tests) refreshes just run.
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? (locks.request('grimoire-token-refresh', fn) as Promise<T>) : fn()
}

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = withRefreshLock(() =>
      fetch('/api/auth/refresh', {
        method: 'POST',
        // The refresh cookie is HttpOnly and path-scoped; it rides along here.
        credentials: 'same-origin',
      })
        .then((res) => (res.ok ? (res.json() as Promise<Schema<'LoginResponse'> | null>) : null))
        .then((body) => {
          if (!body?.token) return null
          setAccessToken(body.token)
          return body.token
        })
        .catch(() => null)
    ).finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

// Perform a request, transparently refreshing and retrying once on a 401.
// `build` is called fresh for each attempt so the retry picks up the new token.
async function authedFetch(url: string, build: () => RequestInit): Promise<Response> {
  const res = await fetch(url, build())
  if (res.status !== 401) return res
  if (NO_REFRESH_PATHS.some((p) => url.startsWith(`/api${p}`))) return res
  // No stored token means we were never logged in — nothing to refresh.
  if (!getToken()) return res

  const token = await refreshAccessToken()
  if (!token) return res
  return fetch(url, build())
}

// Pull a human-readable message out of an error body. FastAPI's `detail` is a
// string for the HTTPExceptions we raise ourselves, but a *list* of
// `{loc, msg, type}` objects for a 422 from schema validation — and stringifying
// that shows the user "[object Object]" rather than the reason (e.g. the tag
// naming rule in issue #430). Join the messages instead, dropping Pydantic's
// "Value error, " prefix, which means nothing to someone who did not write the
// validator.
//
// A detail may also be an object carrying a `message` beside data the caller
// acts on (`{message, needs_input}` from a character import); the message is
// what the user reads.
function errorDetail(body: unknown): string | null {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  const message = (detail as { message?: unknown } | null | undefined)?.message
  if (typeof message === 'string') return message
  if (!Array.isArray(detail)) return null
  const messages = detail
    .map((e: { msg?: unknown } | null) => String(e?.msg || '').replace(/^Value error,\s*/, ''))
    .filter(Boolean)
  return messages.length ? [...new Set(messages)].join('; ') : null
}

async function handleResponse(res: Response): Promise<unknown> {
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('grimoire:unauthorized'))
    throw apiError('Unauthorized', { status: 401 })
  }
  if (res.status === 204) return null
  // Not every error body is JSON: an unhandled server exception returns the
  // plain text "Internal Server Error", and parsing that threw a misleading
  // SyntaxError that masked the real failure (issue #270). Parse defensively and
  // fall back to the status text.
  const raw = await res.text()
  let body: unknown = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const detail = errorDetail(body) || raw?.trim() || res.statusText || 'Request failed'
    throw apiError(detail, { status: res.status, body })
  }
  return body
}

// The filename a Content-Disposition header names. The RFC 6266 `filename*`
// form wins when present: it carries the real UTF-8 name, where the plain
// `filename` is an ASCII fallback with `?` in place of anything else.
export function dispositionFilename(header: string | null | undefined): string | null {
  if (!header) return null
  const star = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      // Malformed escape: fall through to the plain form.
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i)
  return plain ? plain[1] : null
}

// --- Typed requests (issue #587) -------------------------------------------
// Every helper below names its route by the OpenAPI path template - the path
// as the backend declares it, minus the /api prefix - so tsc checks the route
// exists for that method, that every path parameter is supplied, and that the
// query and body match the schema, and types the response from it.

type LooseOptions = {
  path?: Record<string, Id>
  query?: object
  body?: unknown
}

// Append query values the schema does not declare (cache-busters, the
// catalogue's free-form `filter[...]` keys) to a URL that may already have some.
export function withQuery(url: string, extra: [string, string][]): string {
  if (!extra.length) return url
  const qs = new URLSearchParams(extra).toString()
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`
}

/**
 * The URL (without /api) for `method` on a path template: path parameters are
 * filled in and URL-encoded, and query values that are undefined or null are
 * left out. Arrays repeat the key, which is how FastAPI reads a list.
 *
 * Never throws. A parameter that is still undefined at runtime (a route param
 * not loaded yet, in JavaScript the types cannot reach) becomes "undefined", as
 * the template strings this replaced did: the request then fails with a 404 the
 * caller already handles, and a media URL built during render stays a string
 * rather than crashing the page.
 */
function routeUrl(path: string, options?: LooseOptions): string {
  const filled = path.replace(/\{(\w+)\}/g, (_, name: string) =>
    encodeURIComponent(String(options?.path?.[name]))
  )
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, String(v)))
    else qs.append(key, String(value))
  }
  const query = qs.toString()
  return query ? `${filled}?${query}` : filled
}

/** The URL for `method` on `path`, checked against the schema. */
export function urlFor<M extends HttpMethod, P extends PathsFor<M>>(
  method: M,
  path: P,
  ...[options]: RequestArgs<Operation<P, M>>
): string {
  void method // only narrows which paths `path` may name
  return routeUrl(path, options as LooseOptions | undefined)
}

// Async so that anything going wrong while building the request reaches the
// caller as a rejection, like a failed request, never as a synchronous throw.
async function send(method: HttpMethod, path: ApiPath, options?: LooseOptions): Promise<unknown> {
  const url = routeUrl(path, options)
  if (method === 'get') return api.get(url)
  return api[method](url, options?.body)
}

type Typed<M extends HttpMethod> = <P extends PathsFor<M>>(
  path: P,
  ...args: RequestArgs<Operation<P, M>>
) => Promise<SuccessBody<Operation<P, M>>>

function typed<M extends HttpMethod>(method: M): Typed<M> {
  return ((path: ApiPath, options?: LooseOptions) => send(method, path, options)) as Typed<M>
}

/**
 * A client typed from the OpenAPI schema. New code should prefer it over the
 * raw `api.get(url)` form, which can only type a literal URL:
 *
 *     client.get('/campaigns/{campaign_id}', { path: { campaign_id: id } })
 */
export const client = {
  get: typed('get'),
  post: typed('post'),
  put: typed('put'),
  patch: typed('patch'),
  delete: typed('delete'),
}

/** The JSON body `method` on `path` accepts. */
export type BodyOf<P extends ApiPath, M extends HttpMethod> = JsonBody<Operation<P, M>>

/** The query parameters `method` on `path` declares. */
export type QueryOf<P extends ApiPath, M extends HttpMethod> = QueryParams<Operation<P, M>>

/** What `method` on `path` resolves to. */
export type ResponseOf<P extends ApiPath, M extends HttpMethod> = SuccessBody<Operation<P, M>>

export type { RequestOptions }

// Build a URL for an <img>/download/media endpoint. These requests can't send
// an Authorization header, so they authenticate via the HttpOnly session cookie
// set at login — the JWT is deliberately NOT put in the URL (query params leak
// into proxy logs, Referer headers, and browser history; see issue #156).
export const mediaUrl = (path: string, params: Record<string, Id | undefined> = {}): string => {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]): [string, string] => [k, String(v)])
  ).toString()
  return `/api${path}${qs ? `?${qs}` : ''}`
}

// A GET path's URL for mediaUrl, checked against the schema.
export const getUrl = <P extends PathsFor<'get'>>(
  path: P,
  ...args: RequestArgs<Operation<P, 'get'>>
) => urlFor('get', path, ...args)

export const postUrl = <P extends PathsFor<'post'>>(
  path: P,
  ...args: RequestArgs<Operation<P, 'post'>>
) => urlFor('post', path, ...args)

// `v` cache-busts a URL whose content can change under it.
export const cacheBust = (v?: Id | null): Record<string, Id> => (v ? { v } : {})

// URL for a rendered book page. `contentToken` identifies the source file's
// *contents* (from BookDetail.content_token), so replacing the PDF on disk
// changes the URL. Page responses are cached `immutable` for a year, which means
// a browser holding the old render would otherwise never re-request it — the
// token is what makes a replaced book actually show its new pages.
//
// Thumbnails have `bookThumbUrl` below, keyed on the custom cover's version
// rather than the file's contents: list payloads carry that version, not a hash.
export const bookPageUrl = (bookId: Id, page: Id, width?: Id, contentToken?: string | null) =>
  mediaUrl(
    getUrl('/books/{book_id}/page/{page_num}', { path: { book_id: bookId, page_num: page } }),
    contentToken ? { width, v: contentToken } : { width }
  )

// URL for a book's cover thumbnail. `coverVersion` (BookDetail/BookOut/
// BookListItem.cover_version) is set when a custom cover was uploaded and changes
// with it. Thumbnails are cached `immutable`, so without it in the URL a browser
// that had the generated cover would keep showing it after an upload.
export const bookThumbUrl = (bookId: Id, coverVersion?: string | null) =>
  mediaUrl(
    getUrl('/books/{book_id}/thumbnail', { path: { book_id: bookId } }),
    cacheBust(coverVersion)
  )

/** One file of a picked folder, with its path inside that folder. */
export interface FolderEntry {
  file: File
  path?: string
}

// Drop the empty values a filter form leaves behind, so they are not sent as `key=`.
export function presentParams<T extends object>(params: T): T {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ) as T
}

const api = {
  get: <U extends string>(url: U): Promise<UrlResult<U, 'get'>> =>
    authedFetch(`/api${url}`, () => ({ headers: authHeaders() })).then(handleResponse) as Promise<
      UrlResult<U, 'get'>
    >,

  post: <U extends string>(url: U, data?: unknown): Promise<UrlResult<U, 'post'>> =>
    authedFetch(`/api${url}`, () => ({
      method: 'POST',
      headers: authHeaders(!!data),
      body: data ? JSON.stringify(data) : undefined,
    })).then(handleResponse) as Promise<UrlResult<U, 'post'>>,

  patch: <U extends string>(url: U, data?: unknown): Promise<UrlResult<U, 'patch'>> =>
    authedFetch(`/api${url}`, () => ({
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify(data),
    })).then(handleResponse) as Promise<UrlResult<U, 'patch'>>,

  put: <U extends string>(url: U, data?: unknown): Promise<UrlResult<U, 'put'>> =>
    authedFetch(`/api${url}`, () => ({
      method: 'PUT',
      headers: authHeaders(!!data),
      body: data ? JSON.stringify(data) : undefined,
    })).then(handleResponse) as Promise<UrlResult<U, 'put'>>,

  // `data` is optional — most DELETEs identify their target in the URL, but the
  // file-management endpoints send a library path in the body so names
  // containing URL metacharacters survive intact.
  delete: <U extends string>(url: U, data?: unknown): Promise<UrlResult<U, 'delete'>> =>
    authedFetch(`/api${url}`, () => ({
      method: 'DELETE',
      headers: authHeaders(!!data),
      body: data ? JSON.stringify(data) : undefined,
    })).then(handleResponse) as Promise<UrlResult<U, 'delete'>>,

  // Fetch a file response and trigger a browser download. The server's
  // Content-Disposition filename wins; `fallback` is used only if it's absent.
  // `method`/`body` let an export POST its request (a JSON body) and still land
  // as a download.
  download: async (
    url: string,
    fallback: string,
    { method = 'GET', body }: { method?: string; body?: unknown } = {}
  ): Promise<void> => {
    const hasBody = body !== undefined
    const res = await authedFetch(`/api${url}`, () => ({
      method,
      headers: authHeaders(hasBody),
      body: hasBody ? JSON.stringify(body) : undefined,
    }))
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('grimoire:unauthorized'))
      throw apiError('Unauthorized', { status: 401 })
    }
    if (!res.ok) {
      let detail = 'Request failed'
      try {
        detail = (await res.json()).detail || detail
      } catch {
        // non-JSON error body
      }
      throw apiError(detail, { status: res.status })
    }
    const filename = dispositionFilename(res.headers.get('Content-Disposition')) || fallback
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objectUrl)
  },

  // Multipart upload — do NOT set Content-Type so the browser adds the boundary.
  // `fields` appends extra form values alongside the file.
  upload: (
    url: string,
    file: Blob,
    fields: Record<string, string | Blob> = {}
  ): Promise<unknown> => {
    // Rebuilt per attempt: a FormData body is a one-shot stream, so a retry
    // after a token refresh needs its own instance.
    const buildForm = () => {
      const form = new FormData()
      form.append('file', file)
      for (const [k, v] of Object.entries(fields)) form.append(k, v)
      return form
    }
    return authedFetch(`/api${url}`, () => ({
      method: 'POST',
      headers: authHeaders(),
      body: buildForm(),
    })).then(handleResponse)
  },

  // Multipart upload of a whole folder pick: every file in one request, each
  // with its path within the picked folder so the server can rebuild the tree.
  // Separate from `upload` because that one sends a single `file` part.
  uploadFolder: (url: string, entries: FolderEntry[]): Promise<unknown> => {
    // Rebuilt per attempt for the same reason as `upload` above: a FormData
    // body is a one-shot stream, so a retry needs its own instance.
    const buildForm = () => {
      const form = new FormData()
      for (const { file, path } of entries) {
        form.append('files', file)
        form.append('paths', path || file.name)
      }
      return form
    }
    return authedFetch(`/api${url}`, () => ({
      method: 'POST',
      headers: authHeaders(),
      body: buildForm(),
    })).then(handleResponse)
  },
}

export default api
