# QuicRun

Fast path to run the dashboard locally.

## Prerequisites

- Node.js `20+`
- npm (bundled with Node)
- [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`) for full-stack dev (Vite + API routes)

## 1) Install dependencies

```bash
npm install
```

## 2) Configure environment variables

Copy the example env file:

```bash
cp .env.example .env
```

Set values in `.env`:

- `DATABASE_URL` — Postgres connection string (use Neon’s **pooled** URI on Vercel)
- `BUBBLE_API_TOKEN` — Bubble API bearer token
- `BUBBLE_API_BASE_URL` — Bubble API base URL (default `https://app.getvetwise.com/api/1.1`)
- `BUBBLE_CORPORATE_PROFILE_FIELD` — optional Bubble field override for the corporate profile filter
- `BUBBLE_CORPORATE_PROFILE_ID` — optional Bubble value override for the corporate profile filter
- `BUBBLE_TRACKING_STATUS_FIELD` — optional Bubble field override for the tracking status filter
- `BUBBLE_TRACKING_STATUS_VALUE` — optional Bubble value override for the tracking status filter
- `BUBBLE_CANCELLED_AT_FIELD` — optional Bubble field override for the cancelled-at filter
- `BUBBLE_MODIFIED_DATE_FIELD` — optional Bubble field override for incremental sync sorting/filtering
- `DASHBOARD_PASSWORD` — dashboard login password (defaults to `VetWise!2000` if not set)
- `DASHBOARD_AUTH_SECRET` — secret used to sign auth tokens
- `INGEST_API_KEY` — optional key required for `POST /api/ingest`
- `CRON_SECRET` — must match the secret in the Vercel project for [secured cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs) (`GET /api/cron/ingest`)
- `INGEST_MAX_DURATION_MS` — optional timeout for incremental ingestion (default `8000`)
- `INGEST_FULL_MAX_DURATION_MS` — optional timeout for full sync ingestion (default `25000`)

## 3) Start local development

Use Vercel dev so both the Vite frontend and serverless API run together:

```bash
npx vercel dev
```

Open the URL shown in the terminal (often `http://localhost:3000`).

## 4) Quick API checks

Health/auth session check:

```bash
curl "http://localhost:3000/api/auth/session"
```

Trigger incremental ingestion:

```bash
curl -X POST "http://localhost:3000/api/ingest" \
  -H "x-ingest-key: $INGEST_API_KEY"
```

Trigger full ingestion:

```bash
curl -X POST "http://localhost:3000/api/ingest?full=true" \
  -H "x-ingest-key: $INGEST_API_KEY"
```

## 5) Build and preview production output

```bash
npm run build
npm run preview
```

`npm run preview` serves the static Vite build only (no API). Use `vercel dev` or a deployed preview for API-backed flows.
