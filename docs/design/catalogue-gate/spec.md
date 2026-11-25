# The 18+ gate — spec

**Status:** live (2026-11-25)
**Replaces:** the public/members content split (2026-08 → 2026-11)

## Decision

The site's front door is a one-tap **18+ declaration**, not a login.
Signed-in state no longer changes what content a visitor can see:

| Viewer | Catalogue / community / tools / legal | Actions & private data |
|---|---|---|
| Un-declared (crawler or person) | the `/gate` page only | — |
| Declared 18+ visitor (`ao_cat`) | full content | sign-in required |
| Signed-in member | full content (identical) | allowed |

`signed-in == declared` for reading. The only content that stays signed-in-only
is the **Document Library** (vault, motivation applications and their review
sheets) plus saved personal data (trackers, orders, account).

## Mechanism

- Declaration cookie `ao_cat`: JWT HS256, `purpose` + `audience`
  `catalogue-gate`, 30 days, signed with `JWT_MEMBER_SECRET`, **no `sub`** so
  it can never authenticate. Minted/cleared by
  `POST`/`DELETE /api/auth/catalogue-declare`; set HttpOnly, Secure in prod,
  SameSite=Lax, Path=/.
- Route classes in `frontend/lib/route-gate.ts`: gate-exempt / member-only /
  content (default). Middleware redirects un-declared content requests to
  `/gate?next=…` and member-only requests to sign-in.
- Backend enforcement: `OptionalAuthGuard` stamps `catalogueDeclared`;
  `ContentAccessGuard` 404s content reads with neither a session nor a
  declaration. Both are provided locally in every module that mounts a
  content controller.
- SEO: `robots.txt` disallows the site, no content sitemap, gate page
  `noindex` + generic brand OG. A crawler therefore only ever receives the
  neutral gate page. **No user-agent branching — the mechanism is that a
  crawler does not click.**

## Why not "public but not indexed"?

`noindex`/`robots` stop indexing, not fetching. Meta's link-preview fetcher
ignores robots.txt and fetches shared URLs; if the content were in the HTML, it
would read it. The age click is the only compliant thing a crawler will not
do. (Detecting the crawler and serving it something else is cloaking — the
exact behaviour the 2026-08 gating avoided after two Meta restrictions.)

## Consequences accepted

- Organic search of listings/community ends. `robots.txt` disallow + no
  sitemap is the honest state.
- Two statutory/platform carve-outs stay outside the gate: `/data-deletion`
  (Meta requirement) and `/paia` (PAIA s51 free public access). Terms and every
  other legal page are gated as requested.
- The declaration is a click, not age verification; a human moderator or a
  script that deliberately POSTs can still see the content (exactly as anyone
  can today by creating a free account). This residual risk is accepted.
- `Category.publicVisible` / `Listing.publicVisible` remain in the database as
  legacy data (the 2026-08 gating data is untouched) but no longer decide
  display.

## Tests that lock it

- `backend/src/auth/content-access.spec.ts` — the 404 boundary.
- `backend/src/auth/optional-auth.guard.spec.ts` — session vs declaration.
- `backend/src/auth/session.service.catalogue.spec.ts` — token separation.
- `backend/src/listings/content-visibility.spec.ts` — no `publicVisible`
  filters, status gates intact.
- `frontend/lib/route-gate.spec.ts` — the three classes and prefix boundaries.
