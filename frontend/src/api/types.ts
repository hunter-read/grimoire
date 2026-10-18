/**
 * Type-level plumbing between the generated OpenAPI types (./schema.d.ts) and
 * the request helpers in ../api.ts (issue #587).
 *
 * Paths here are written the way the frontend writes them - without the `/api`
 * prefix the backend mounts every route under - so `'/campaigns/{campaign_id}'`
 * names the operation the schema keys as `'/api/campaigns/{campaign_id}'`.
 */
import type { paths } from './schema'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

/** Every API path, without the `/api` prefix. */
export type ApiPath = keyof paths extends infer K ? (K extends `/api${infer P}` ? P : never) : never

/** The operation behind `method` on `path`, or `undefined` when it has none. */
export type Operation<P extends ApiPath, M extends HttpMethod> = paths[`/api${P}`][M]

/** The paths that accept `method`. */
export type PathsFor<M extends HttpMethod> = {
  [P in ApiPath]: Operation<P, M> extends { responses: unknown } ? P : never
}[ApiPath]

type JsonContent<R> = R extends { content: { 'application/json': infer T } } ? T : unknown

/**
 * What a successful call resolves to: the 200/201/202 JSON body, or `null` for
 * a 204 (the request helpers return null for an empty response). Routes that
 * serve a file rather than JSON come out as `unknown`.
 */
export type SuccessBody<O> = O extends { responses: infer R }
  ? 200 extends keyof R
    ? JsonContent<R[200]>
    : 201 extends keyof R
      ? JsonContent<R[201]>
      : 202 extends keyof R
        ? JsonContent<R[202]>
        : 204 extends keyof R
          ? null
          : unknown
  : unknown

/** The JSON request body an operation takes, or `never` when it takes none. */
export type JsonBody<O> = O extends { requestBody?: infer B }
  ? NonNullable<B> extends { content: { 'application/json': infer T } }
    ? T
    : never
  : never

/** The query parameters an operation declares. */
export type QueryParams<O> = O extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never

type PathParamsOf<O> = O extends { parameters: { path: infer PP } } ? PP : never

/**
 * Path parameters by name. Every declared name is required and no other is
 * allowed; values are taken as `string | number` because they end up as URL
 * segments either way, and route params arrive as strings.
 */
export type PathParams<O> = [PathParamsOf<O>] extends [never]
  ? never
  : { [K in keyof PathParamsOf<O>]: string | number }

/** Options for a typed request: `path` is required exactly when the route has parameters. */
export type RequestOptions<O> = ([PathParams<O>] extends [never]
  ? { path?: never }
  : { path: PathParams<O> }) & {
  query?: QueryParams<O>
} & ([JsonBody<O>] extends [never] ? { body?: never } : { body?: JsonBody<O> })

/** `[options]`, optional when nothing in it is required. */
export type RequestArgs<O> = [PathParams<O>] extends [never]
  ? [options?: RequestOptions<O>]
  : [options: RequestOptions<O>]

type StripQuery<U extends string> = U extends `${infer P}?${string}` ? P : U

/**
 * The response for a raw `api.get('/literal/path')` call. A literal URL that
 * names an operation is typed; anything built at runtime (a template string
 * with values in it) is `unknown`, so the caller has to say what it expects.
 */
export type UrlResult<U extends string, M extends HttpMethod> = string extends U
  ? unknown
  : StripQuery<U> extends PathsFor<M>
    ? SuccessBody<Operation<StripQuery<U>, M>>
    : unknown
