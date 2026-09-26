# web

Next.js UI for Ripple. Owner: Jack.
Uses the read-only `MONGODB_URI_READER` only — the worker is the single writer (AGENTS.md).

Next.js 16 + React 19 + Tailwind 4, App Router. Scaffolded with `create-next-app`;
v0-generated components get grafted in as polish.

## Run

```
npm install          # from the repo root (npm workspaces)
npm run dev -w @ripple/web
```

Opens on http://localhost:3000.

## Data

Everything renders from fixtures in `lib/fixtures.ts` until the real collections land,
so the UI can be built and demoed before Atlas is populated. Fixtures are typed with the
frozen contracts from `@ripple/types`, so switching to live data is a swap of the
data source, not a rewrite.

Live updates (DESIGN.md §3): locally the demo streams Atlas change streams; on Vercel it
polls, because serverless functions can't hold a stream open.
