# All Outdoor Agent Rules

## Scope

- Read `docs/project-reference.md` before changing behavior covered by a detailed system rule.
- Read `docs/INDEX.md` before concluding that a topic is undocumented.
- When code and documentation disagree, treat the code as authoritative, tell the operator, and update the documentation when appropriate.
- Keep changes minimal, focused, and compatible with the existing patterns.
- Do not undo or modify unrelated worktree changes.
- Use `apply_patch` for manual edits. Do not use destructive commands such as `git reset --hard` or `git checkout --`.
- Do not commit, amend, push, or create a PR unless explicitly requested.

## Product And Privacy

- Use brand constants from `frontend/lib/brand.ts` and `backend/src/common/brand.ts`; never hard-code the brand.
- Never expose the retired company name or a competitor in user-facing copy.
- Never use `Escrow` or `KYC` in user-facing copy. Use the approved payment and verification wording from the reference.
- Never expose real names to other users. Public surfaces use `username` only, with the approved anonymous fallbacks.
- KYC is seller-only. Never gate buying, bidding, or making offers on `kycStatus`.
- Never store raw card numbers. Never add a wallet, stored balance, or ledger.
- Keep secrets in `.env` only; never put secret values in source, documentation, commits, or chat.

## Regulated Goods

- Firearms and barrels may use only `DEALER_TRANSFER` or `PRIVATE_ARRANGE`; never courier or locker shipment.
- Every firearm listing must offer `DEALER_TRANSFER`; `PRIVATE_ARRANGE` requires the existing consent flow.
- Air rifles are not firearms and use the `air-rifles` category.
- Live ammunition, primers, and propellant are banned. Empty or once-fired brass and projectiles are allowed.
- Preserve the public/member auth wall. Never branch public content by user-agent or crawler identity.
- Public viewer-varying reads require the existing optional auth and visibility gates, must not be shared-cached, and must use `no-store` viewer fetches where applicable.
- A hidden listing/category must return 404 rather than confirm its existence.
- Do not weaken public weapon-word checks or remove `publicVisible` from Meilisearch filterable attributes.

## Engineering Traps

- Never run `prisma db push`; use `prisma generate` for routine deploys and migrations for schema changes.
- Preserve the raw-DDL FTS columns and indexes that are intentionally absent from `schema.prisma`.
- Every module mounting a guarded controller must provide that guard's dependencies locally and have a boot spec.
- Route all model calls through `LlmService`; callers must not create provider clients, choose models, or parse provider responses themselves.
- Do not trust empty image-model output; treat it as a refusal and do not store zero-byte images.
- Preserve `prisma-client-js` and the Prisma 7 driver adapter configuration.
- For viewer-varying data, never add `revalidate` or `force-cache`.

## Frontend

- Preserve the white shop theme and its canonical tokens in `frontend/app/globals.css`.
- Do not remove the global box-shadow kill switch or alter the logo red to match `--red`.
- Keep the theme-sync build gate passing; `--bg`, manifest colors, and layout theme color must agree.
- Keep `/api/*` service-worker routes network-only, and do not enable `skipWaiting` or `clientsClaim`.
- Do not edit vendored scanner copies under `frontend/lib/scan-v3` or `frontend/components/scan-v3`.
- Component specs must use `.spec.tsx`; the frontend test include otherwise silently omits them.

## Deployments

- Treat `deploy now` as an explicit runbook command. Follow the complete sequence in `docs/project-reference.md`, stop on the first failure, and report it.
- Deploy only from `feat/takealot-ux-parity`, never `main`, and use the `alloutdoor` SSH alias.
- Run type-checks, both test suites, and the foreground frontend production build before deployment.
- Stage deliberately; never use `git add .`.
- Generate Prisma before building, verify build artefacts before reload, and remember PM2 reload is a restart, not zero-downtime.
- Ask before deploying if a motivation generation may be in progress.

## Verification

- Prefer targeted tests and type-checks for the changed area, then run the relevant broader checks.
- Before reporting completion, inspect the diff and status, and state any checks that could not run.

## Model Routing and Delegation

- Treat this initial session context as an absolute priority router before executing code tools.
- If the operator's prompt targets visual layouts, CSS patterns, design assets, or Tailwind configurations, immediately route the execution context by invoking the subagent: `/agent frontend <original_prompt_details>`
- If the operator's prompt targets backend schema alterations, intense database queries, or large application pipelines, route the context by invoking the subagent: `/agent heavy <original_prompt_details>`
- If the operator's prompt involves mass renames, category replacements, or multi-file mechanical refactoring, route the context by invoking the subagent: `/agent bulk-edit <original_prompt_details>`
- If the operator specifies a deep bug, unexpected production failure, or complex transaction race condition, route the execution context by invoking the subagent: `/agent hard <original_prompt_details>`
- For standard everyday features, straightforward component writing, or simple code generation adjustments, route execution context directly by invoking: `/agent build <original_prompt_details>`
- Do not attempt to execute or patch file blocks yourself in this initial route turn. Read the intent, match the category, output the subagent trigger string, and delegate immediately.
