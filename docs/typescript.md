# TypeScript in the frontend

Everything under `frontend/src/` is TypeScript (`.ts`/`.tsx`), tests included, and `tsc`
checks all of it under `strict`. The frontend started out in JavaScript and was converted a
file at a time; JavaScript is no longer allowed under `src/`, and CI fails if a `.js` or
`.jsx` file appears there. Config files and scripts outside `src/` (`vite.config.js`,
`eslint.config.js`, `scripts/*.mjs`) are still plain JavaScript.

The point is the contract between the frontend and the backend. The backend already
describes every request and response in its OpenAPI schema; the frontend now consumes it, so
a renamed or removed field fails `tsc` in the PR that changes it rather than in a browser.

## The commands

All run from `frontend/`:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc` over `src/`, under `strict`. |
| `npm run api:types` | Regenerates `src/api/schema.d.ts` from the backend's OpenAPI schema. |
| `npm run api:types:check` | Fails if `src/api/schema.d.ts` is out of date. |
| `npm run typescript:check` | Fails if there is a `.js`/`.jsx` file anywhere under `src/`. |

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

3. **The raw transport** (`api.get(url)`, the default export) is what older code uses. A
   literal URL is typed (`api.get('/latest-release')`); a URL built at runtime
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

## Writing TypeScript here

- Give each component an `interface` for its props, and export it when another directory
  renders the component.
- Type data from the API with `Schema<'Name'>` rather than writing the shape out again.
- Give `useState` a type when the initial value doesn't say enough
  (`useState<Schema<'BookOut'> | null>(null)`), and type event handlers
  (`React.ChangeEvent<HTMLInputElement>`).
- In tests, reach mocks through `vi.mocked(fn)` (`vi.mocked(api.get).mockResolvedValue(...)`)
  and use `globalThis` rather than `global`.

ESLint applies [typescript-eslint](https://typescript-eslint.io/)'s recommended rules on
top of the project's React rules, so `any` needs a reason
(`// eslint-disable-next-line @typescript-eslint/no-explicit-any -- why`). `@ts-ignore` is
never used; a `@ts-expect-error` carries a comment saying why.

## TypeScript version

TypeScript is held at 5.x: `openapi-typescript` and `typescript-eslint` are built on
TypeScript's JavaScript API and do not support TypeScript 7 (the native port) yet.
Dependabot is told to skip that major until they do.
