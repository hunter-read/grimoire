# TypeScript in the frontend

The frontend is moving from JavaScript to TypeScript one file at a time. There is no
big-bang rewrite: `.js`/`.jsx` and `.ts`/`.tsx` files live side by side, Vite and Vitest
compile both, and a CI ratchet makes sure the JavaScript only ever shrinks.

The point is the contract between the frontend and the backend. The backend already
describes every request and response in its OpenAPI schema; the frontend now consumes it, so
a renamed or removed field fails `tsc` in the PR that changes it rather than in a browser.

## The commands

All run from `frontend/`:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc` over `src/`. TypeScript files are checked under `strict`; JavaScript files are part of the program (so TypeScript can import them) but not checked. |
| `npm run api:types` | Regenerates `src/api/schema.d.ts` from the backend's OpenAPI schema. |
| `npm run api:types:check` | Fails if `src/api/schema.d.ts` is out of date. |
| `npm run typescript:check` | The ratchet: fails if a change adds JavaScript, or modifies a JavaScript source file, under `src/`. |

CI runs all four - see [CI/CD pipelines](pipelines.md#ci-ciyml).

## API types

`src/api/schema.d.ts` is generated, never edited by hand. `npm run api:types` exports the
schema straight from the FastAPI app with
[`backend/scripts/export_openapi.py`](../backend/scripts/export_openapi.py) - no server
needed, only the backend's Python dependencies - and turns it into TypeScript with
[openapi-typescript](https://openapi-ts.dev/).

**After changing a backend route or one of its Pydantic models, run `npm run api:types` and
commit the result** alongside the backend change. The `API types up to date` CI job fails
until you do, and the regenerated file is what lets `tsc` flag frontend code that no longer
fits. A Dependabot bump of FastAPI or Pydantic can change the schema too; regenerate on that
branch the same way.

The exporter points `DATA_PATH` and `LIBRARY_PATH` at a throwaway directory (importing the
app runs migrations) and pins the flags that add or remove routes, so the output is the same
on every machine.

## Calling the API

[`src/api.ts`](../frontend/src/api.ts) is still the one place to import from. It offers three
levels, from most to least typed:

1. **The helpers** (`campaigns.get(id)`, `tags.list()`, …) are built on the typed client, so
   their arguments and results are typed with no extra work.
2. **`client`** for a route no helper covers. Name the route by its OpenAPI path template -
   as the backend declares it, without the `/api` prefix:

   ```ts
   import { client } from '../api'

   const page = await client.get('/campaigns/{campaign_id}/wiki/{page_id}', {
     path: { campaign_id: campaignId, page_id: pageId },
   })
   await client.patch('/campaigns/{campaign_id}', {
     path: { campaign_id: campaignId },
     body: { name: 'Curse of Strahd' },
   })
   ```

   `tsc` checks the route exists for that method, that every path parameter is given (by
   name), and that the query and body match the schema; the result is typed from the
   response model.

3. **The raw transport** (`api.get(url)`, the default export) is what existing JavaScript
   uses. A literal URL is typed (`api.get('/latest-release')`); a URL built at runtime
   resolves to `unknown`, so TypeScript code using it has to say what it expects. Prefer the
   two above in new code.

Schema models are available by name for props and state:

```ts
import type { Schema } from '../api'

interface Props {
  campaign: Schema<'CampaignOut'>
}
```

`BodyOf<path, method>`, `QueryOf<path, method>` and `ResponseOf<path, method>` name the
pieces of one operation.

A field with a default on the backend is optional in these types, in requests and responses
alike: Pydantic does not list defaulted fields as required in its schema, so the generator
cannot tell a response always carries them.

## Converting a file

The ratchet decides when: a change that modifies a non-test `.js`/`.jsx` file under `src/`
has to convert it. To convert one:

1. Rename it with `git mv` (so history follows), `.js` → `.ts`, `.jsx` → `.tsx`.
   Imports are extensionless, so nothing that imports it changes.
2. Run `npm run typecheck` and fix what it reports. The usual work is typing props
   (an `interface` for the component's props), `useState` initial values that start as
   `null`, and event handlers. Type data from the API with `Schema<'Name'>` rather than
   writing the shape out again.
3. Convert the file's test alongside it when it is small enough to; a test that stays
   JavaScript still runs, and the ratchet allows a modified `.test.js(x)`.

In a TypeScript test, reach mocks through `vi.mocked(fn)` (`vi.mocked(api.get).mockResolvedValue(...)`)
and use `globalThis` rather than `global`.

New files - tests included - are written in TypeScript from the start.

ESLint applies [typescript-eslint](https://typescript-eslint.io/)'s recommended rules to
TypeScript files on top of the project's React rules, so `any` needs a reason
(`// eslint-disable-next-line @typescript-eslint/no-explicit-any`).

## TypeScript version

TypeScript is held at 5.x: `openapi-typescript` and `typescript-eslint` are built on
TypeScript's JavaScript API and do not support TypeScript 7 (the native port) yet.
Dependabot is told to skip that major until they do.
