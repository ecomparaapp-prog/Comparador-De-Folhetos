# Preço Certo

Aplicativo em português para extrair ofertas de folhetos de supermercado, comparar preços e estimar o custo de uma lista de compras.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — PostgreSQL connection string; `OPENROUTER_API_KEY` — secret used by flyer image analysis
- Optional AI config: `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_MODEL`; OpenRouter defaults to `https://openrouter.ai/api/v1` and `google/gemma-4-26b-a4b-it:free`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract and generated client/schema source
- `lib/db/src/schema/product-offers.ts` — current offer and shopping-list tables
- `artifacts/api-server/src/routes/prices.ts` — flyer analysis, exact product comparison, and shopping-list logic
- `artifacts/preco-certo/src/App.tsx` and `src/index.css` — web interface and theme

## Architecture decisions

- Flyer images are sent to the configured vision endpoint for extraction and are not archived; reviewed offer records and the shopping list are stored in PostgreSQL. **Why:** the requested flow needs image extraction and review, not a flyer archive. **How to apply:** revisit if users need to retain source images for audit.
- Product lookup uses normalized full-name equality, and the same product at one supermarket is replaced only by an offer with an equal or newer flyer date. **Why:** avoid broad-match false positives and stale prices. **How to apply:** keep any future search expansion separate from the exact-match comparison.

## Product

- Upload or capture a flyer image, extract offers with a configurable OpenAI-compatible vision model, review and correct fields, then save.
- Compare exact product names across supermarkets with the lowest price and per-store savings.
- Build a shopping list and compare covered-item totals and savings by supermarket.
- The shopping list is currently shared within this app instance; add user accounts and ownership before using it as a multi-user public service.

## User preferences

_No standing user preferences recorded._

## Gotchas

- Configure `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, and `OPENAI_COMPATIBLE_MODEL` together when switching away from the default OpenRouter free vision model.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
