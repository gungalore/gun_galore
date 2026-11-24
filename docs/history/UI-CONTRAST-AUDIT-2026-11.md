# UI contrast audit — quiet buttons and options (2026-11-24)

**Question from the operator:** *"There are a lot of options and buttons on the website and PWA that is the same color as the theme and is hard to spot. Identify all of them and make me a list of which ones makes sense to give them color to pop a bit more."*

**Method (read-only):** static scan of every `<button>` in `frontend/app/**` and
`frontend/components/**` (vendor copies `components/scan*`, `bench` and the
separate admin console excluded), then WCAG contrast maths on the theme tokens
from `frontend/app/globals.css`, then a screen-by-screen manual pass over the
member flows. **629 buttons across 199 files; 461 of them (73%) carry a
surface-coloured or transparent fill** — i.e. no fill difference from the page and
either no border or a `--border` hairline. Most of those 461 are deliberately
quiet icon/dismiss/tertiary controls; this report separates the ones where quiet
styling costs the user.

Every token below is measured against `--bg-card: #FFFFFF` (cards) and
`--bg: #FAF8F3` (page). WCAG asks **3:1 for non-text UI boundaries/components**
(1.4.11) and **4.5:1 for normal text** (1.4.3).

## 1. The theme's quiet tokens are below the affordance threshold

| Token | Value | vs white card | vs page | What it is used for |
|---|---|---|---|---|
| `--border` | `#E7E0D5` | **1.31:1** | 1.24:1 | every secondary button, chip, picker card, input, dropdown, menu edge, card |
| `--border-hover` | `#D8CFC0` | **1.54:1** | 1.45:1 | "stronger" borders, dashed dropzone |
| `--bg-inset` | `#F1ECE2` | **1.18:1** | 1.11:1 | quiet button fill, selected/unselected option fill, search input fill |
| `--bg-card` (as a button fill) | `#FFFFFF` | **1.0:1** | 1.06:1 | white buttons on white cards ("secondary") |
| `--text-faint` | `#A8A095` | **2.58:1** | 2.43:1 | inactive PWA tab labels, unreached wizard steps, disabled hints |
| `--text-tertiary` | `#7A7267` | 4.74:1 | 4.47:1 | many quiet labels (passes text, but only just on the page) |
| `--text-secondary` | `#57534E` | 7.63:1 | 7.25:1 | body/secondary text (passes) |
| `--red` fill + white text | `#B45309` / `#FFFFFF` | **5.02:1** | ✓ | every primary CTA (passes) |
| `--red` text on white | `#B45309` | **5.02:1** | ✓ | accent text links (passes) |

**Root cause is the design system itself.** `docs/design/brand-pack-v1.2/DESIGN.md`
§8 mandates: *secondary = `--surface` bg + 1px `--border-strong`* (1.54:1) and
*ghost = no bg, no border*. That is fine for a tertiary "Cancel", but the same
two variants are used on **required choices** (category/condition/shipping pills,
payment rail, delivery rate, saved address, photo upload) and on **important
secondary money actions** (add to cart, decline/counter, handover dispute). On a
white card the control's boundary is effectively invisible; only the label tells
the user there is a control.

## 2. One outright defect (not a taste question)

[`offer-actions.tsx:185-205`](../app/my/offers/offer-actions.tsx#L185) — the
confirm CTA in the "decline counter" / "withdraw offer" sheet is
`background: var(--bg-inset)` with `color: #fff`:
**white on `#F1ECE2` ≈ 1.18:1 — the label is unreadable in both idle and loading
states.** It should be a destructive fill (`var(--red)` bg, white text) like every
other irreversible confirmation. This is a WCAG 1.4.3 failure, not quiet styling.

## 3. Recommended colour system (fix the vocabulary once, not 461 buttons)

Keep the design rule **one red primary per view** and keep genuinely tertiary
controls quiet. Add two levels between "primary" and "ghost":

1. **Important secondary → accent outline**
   `border: 1px solid var(--red)` + `color: var(--red)` (+ `background:
   transparent` or `var(--bg-card)`).
   Border 5.02:1 on white, text 5.02:1 — passes, and it cannot be mistaken for
   the one red primary because it is not filled.
2. **Options / pickers / chips → visible boundary + selected tint**
   - New token `--border-visible: #9C8F76` — **3.18:1 on white, 3.00:1 on the
     page** (meets 1.4.11 where `--border` does not).
   - Selected: `background: var(--red-wash)` (`#F8F0E9`) + `1px solid var(--red)`
     + `color: var(--text-primary)`; keep the existing `--stone-900` selected
     fill for single-select chips where the design already uses it.
   - Optional soft fill for row options: `--action-soft: #FAF5F0` with
     `--red` text (4.64:1) or `#8A3F07` text (6.94:1).
3. **Ink fixes where the control is a label, not a box**
   - PWA bottom-tab inactive labels: `--text-faint` **2.58:1 at 10px** → raise to
     `--text-tertiary` (4.74:1) minimum, `--text-secondary` (7.63:1) preferred.
   - Unselected rating stars are painted `var(--border)` (1.31:1) → use
     `--text-tertiary` or `--gold`.
4. **Never** put white text on `--bg-inset`/`--bg-card`; **never** use
   `--border` as the only boundary of an interactive control. Both belong in
   `DESIGN.md` §8 as hard rules when this ships.

Suggested additions in `globals.css` (light theme; both themes need the same
values or a dark-mode override):

```css
--border-visible: #9C8F76;   /* 3.18:1 white / 3.00:1 page — interactive edges */
--action-soft:    #FAF5F0;   /* soft accent fill, --red ink passes 4.64:1 */
/* accent outline is just: 1px solid var(--red) + var(--red) text (5.02:1) */
```

## 4. The list — where quiet styling costs the user

### A. Give a real colour (filled primary or destructive)

| Control | Where | Current | Why it matters | Suggested |
|---|---|---|---|---|
| **"Yes, decline" / "Yes, withdraw"** confirm CTA | [`offer-actions.tsx:185`](../app/my/offers/offer-actions.tsx#L185) | `--bg-inset` fill, **white text (1.18:1)** | unreadable; irreversible money decision | **`--red` fill, white text** (destructive) |
| **"Alert me on new matches"** | [`save-search-button.tsx:139`](../components/save-search-button.tsx#L139) | `--bg-inset` + 1.31:1 border | the entire saved-search feature's CTA reads as a passive chip | **`--red` fill** (only CTA in that block) |
| **"Send seller consent form"** | [`licence-centre/[id]/interview/page.tsx:1105`](../app/licence-centre/[id]/interview/page.tsx#L1105) | `--bg-card` + 1.31:1 border, white on white | one of the two actions that step exists for | **`--red` fill** (or accent outline if a primary already exists there) |
| **"Drop photos here or click to upload"** | [`photo-dropzone.tsx:131`](../components/photo-dropzone.tsx#L131) | `--bg-inset` + 0.5px dashed `--border-hover` (1.54:1) | sell flow cannot proceed without it; reads as a cream panel | **accent dashed outline + `--action-soft` fill** (A/B borderline — strongest non-primary treatment) |

### B. Give a visible boundary or accent outline (the big list)

| Area | Control | Where | Current | Suggested |
|---|---|---|---|---|
| **PWA nav** | Home / Messages / Sell / Orders / Account (inactive) | [`bottom-tab-bar.tsx:746`](../components/bottom-tab-bar.tsx#L746) | ink `--text-faint` 2.58:1 at 10px | `--text-tertiary`→`--text-secondary`; keep active bold ink |
| **PWA chrome** | "Motivation Creator", "Armory" quick actions | [`.gg-quick-action`](../app/globals.css#L2225) | white fill + 1.31:1 border | `--border-visible`, or accent outline on the primary one |
| **PWA chrome** | "Shop by category" icon in search row | [`shell-header.tsx:356`](../components/shell/shell-header.tsx#L356) | `--bg-inset` + 1.31:1 border | `--border-visible` or accent outline |
| **PWA chrome** | "Report a bug" floating pill | [`.gg-bug-fab`](../app/globals.css#L2286) | white fill, 1.31:1 border, shadow only | `--action-soft` fill or `--border-visible` |
| **PWA chrome** | Search input | [`live-search.tsx:51`](../components/live-search.tsx#L51) | `--bg-inset` fill, 0.5px `--border` | `--border-visible` 1px (or stronger fill) |
| **Buy** | `Add to cart` | [`add-to-cart-button.tsx:40`](../components/add-to-cart-button.tsx#L40) | `--bg-card` + 1.31:1 border | **accent outline** (keeps Buy as the only filled primary) |
| **Buy** | `Payment method` rows — Instant EFT / Card | [`payment-method-section.tsx:49`](../components/payment-method-section.tsx#L49) | unselected `--bg-card` + 1.31:1; selected = red border only | `--border-visible` on unselected, `--red` border + `--red-wash` on selected |
| **Buy** | Delivery options (Cheapest/Fastest/pickup + price) | [`delivery-options-picker.tsx:273`](../components/delivery-options-picker.tsx#L273) | unselected `--bg-card` + `--border` | same treatment as payment rows |
| **Buy** | `Use my saved address` / `Deliver to a different address` | [`checkout-form.tsx:1252`](../app/checkout/[listingId]/checkout-form.tsx#L1252) | `--bg-card` + 1.31:1 tiles | visible boundary + selected tint |
| **Buy** | Saved address cards | [`saved-address-picker.tsx:82`](../components/saved-address-picker.tsx#L82) | `--bg-inset` + 1.31:1 | visible boundary + selected tint |
| **Buy** | Cart route toggles: `Courier` / `Arrange privately`, `Dealer transfer …` / `Arrange in person …` | [`cart/page.tsx:607`](../app/cart/page.tsx#L607), [`cart/page.tsx:895`](../app/cart/page.tsx#L895) | inactive `--bg-inset` + 1.31:1 | visible boundary + selected tint (these change price/legal route) |
| **Buy** | `Filters` trigger (mobile) | [`filter-bar.tsx:999`](../components/filter-bar.tsx#L999) | inactive `--bg-inset` + 1.31:1 | `--border-visible` or accent outline |
| **Buy** | `Load more` (feed) | [`community/feed-client.tsx:631`](../components/community/feed-client.tsx#L631) | white fill, 1.31:1 | `--border-visible` |
| **Buy** | `Load more` (notifications) | [`notifications-list.tsx:218`](../components/notifications-list.tsx#L218) | white fill, 1.31:1 | `--border-visible` |
| **Listing** | `Rather make an offer?` (offer entry) | [`offer-panel.tsx:448`](../app/listings/[id]/offer-panel.tsx#L448) | `--bg-inset` + 1.31:1 | accent outline |
| **Listing** | `Make another offer`, `Try a higher offer` | [`offer-panel.tsx:426`](../app/listings/[id]/offer-panel.tsx#L426), [:304](../app/listings/[id]/offer-panel.tsx#L304) | `--bg-inset` + 1.31:1 | accent outline |
| **Offers** | `Decline` (buyer counter & seller reject branch) | [`offer-actions.tsx:92`](../app/my/offers/offer-actions.tsx#L92), [`offer-panel.tsx:695`](../app/listings/[id]/offer-panel.tsx#L695) | `--bg-inset` + 1.31:1 | accent outline (losing choice of a 24h money decision) |
| **Offers** | `Withdraw offer` | [`offer-actions.tsx:108`](../app/my/offers/offer-actions.tsx#L108), [`offer-panel.tsx:644`](../app/listings/[id]/offer-panel.tsx#L644) | text-only / inset | accent outline |
| **Transactions** | `Handover did not happen` | [`private-arrange-panel.tsx:111`](../app/transactions/[id]/private-arrange-panel.tsx#L111) | transparent + 1.31:1 border | **danger outline** (red 1px + red text) |
| **Transactions** | `Download receipt (PDF)` | [`download-receipt-button.tsx:56`](../app/transactions/[id]/download-receipt-button.tsx#L56) | `--bg-inset` + 1.31:1 | accent outline |
| **Transactions** | Rating stars (unselected) | [`rating-widget.tsx:112`](../app/transactions/[id]/rating-widget.tsx#L112) | ink `var(--border)` 1.31:1 | `--text-tertiary` or `--gold` |
| **Sell** | Category / condition / shipping / duration pills (unselected) | [`pill.tsx:41`](../components/pill.tsx#L41) | `--bg-inset` + 1.31:1 | `--border-visible` (selected stays ink fill) |
| **Sell** | `Edit these details` | [`listings/new/page.tsx:4262`](../app/listings/new/page.tsx#L4262) | text-only | accent outline / red underlined |
| **Sell** | Wizard `← Back` | [`wizard-footer.tsx:83`](../components/wizard-footer.tsx#L83) | `--bg-card` on white + 1.31:1 | visible boundary |
| **Community** | `💬` comments (only entry to a post) | [`post-card.tsx:566`](../components/community/post-card.tsx#L566) | ink `--text-tertiary`, no chrome | quiet chip/outline with icon |
| **Community** | `⋯` post options (Report/Mute/Delete) | [`post-card.tsx:205`](../components/community/post-card.tsx#L205) | faint 16px glyph | 32px bordered icon button + `--text-secondary` |
| **Community** | Reply (comment thread) | [`comment-thread.tsx:459`](../components/community/comment-thread.tsx#L459) | text-only tertiary | underlined accent text or small outline |
| **Account** | OTP recovery: `Resend code`, `Wrong number?`, `Didn't arrive? Resend code` | [`profile/edit/page.tsx:1336`](../app/profile/edit/page.tsx#L1336), [:1117](../app/profile/edit/page.tsx#L1117), [:1327](../app/profile/edit/page.tsx#L1327) | text-only / 1.31:1 outline | accent text/outline — stuck sign-ups have no obvious exit |
| **Saved items** | `Pause` / `Resume` (saved-search alerts) | [`saved-searches/page.tsx:192`](../app/saved-searches/page.tsx#L192) | `--bg-inset` + 1.31:1 chip | visible boundary |
| **Licence** | `Scan` (evidence), `Send seller consent form` | [`licence-centre/[id]/interview/page.tsx:1085`](../app/licence-centre/[id]/interview/page.tsx#L1085), [:1105](../app/licence-centre/[id]/interview/page.tsx#L1105) | white on white + 1.31:1 | accent outline |
| **Global options** | Every chip rail (categories, filters, tags, calibres) | [`.chip`](../app/globals.css#L2031) | 1px `--border` = 1.31:1 | `--border-visible` on the rail; keep ink/soft-red selected states |
| **Global** | `Try again` empty states | [`category-menu.tsx:270`](../components/category-menu.tsx#L270) | `--bg-inset` + 1.31:1 | visible boundary |

### C. Keep quiet (deliberate, do not repaint)

Cancel/dismiss in dialogs, close (×) buttons, `Share`/`Like` icon+word actions in
the feed, `Clear this notification`, `Show resolved`, wishlist `Remove`,
saved-search `Delete`, `Undo`, `Revert to original`, `Skip for now`, `Manual
entry`, header back chevron and wishlist/cart icons, install-prompt dismissals,
`Log out` and the close-account entry (red ink already carries them), pack
`View`, the settlement/"view profile" text links. These read correctly quiet and
colouring them would flatten the one-primary rule.

**Verified as already correct (do not repaint):** `Buy on Marketplace — R…`,
`Pay R…` / `Continue to payment` (checkout), `Continue to payment` (cart),
`Place Bid` / `Auto Bid` / `Complete checkout`, `Accept counter` /
`Send counter`, `Submit Offer`, `Release payment` / `I received it` /
`Item delivered`, all `Send` buttons, `Submit Offer`, `Create Post` / `Post` /
`Post comment`, `Follow`, sign-in/sign-up and code-verification primaries,
`Start my application`, licence pack choices, `Refresh now`, offline `Try again`.
All are `--red` (or `--success`) fills with white text at 5.02:1.

## 5. Priority order (if only a subset ships now)

1. **Offer confirm CTA readable** — red destructive fill (unreadable label today).
2. **PWA bottom-tab inactive labels** — 2.58:1 at 10px on four primary destinations.
3. **Payment method rows** — the money rail must look selectable.
4. **Delivery-rate cards** — the control that sets price and timing.
5. **Saved-address cards + "Use my saved address / Deliver to a different address"** — wrong-address risk.
6. **`Add to cart`** — second money action currently looks disabled.
7. **Cart route toggles** (`Courier` / `Arrange privately`, dealer/in-person).
8. **`Handover did not happen`** — dispute path in a held-payment handover.
9. **Sell photo dropzone + category/condition/shipping pills** — required steps that read as static labels.
10. **PWA quick actions + "Shop by category" + bug FAB + search field** — the installed app's chrome.
11. Chips/global `.chip` border (`--border-visible`).
12. Community/notifications "Load more", comments button, `⋯` post options, OTP recovery links.
13. Remaining B-list rows (offers, receipt, rating stars, saved-search pause, licence scan/consent).

## 6. Implementation notes

- Add `--border-visible` and `--action-soft` to **both** theme blocks in
  `frontend/app/globals.css` and to `docs/design/brand-pack-v1.2/DESIGN.md` §8
  as rules ("interactive boundary ≥ 3:1"; "never white on `--bg-inset`").
- Do not touch `--bg`/manifest/layout theme colours — the theme-sync build gate
  compares them.
- Keep the one-primary-per-view rule: use **accent outline** for importance, not
  a second filled red button.
- Chips/pickers/dropdowns are shared components (`.chip`, `pill.tsx`,
  `payment-method-section`, `delivery-options-picker`, `saved-address-picker`);
  fixing the component fixes every screen, which is why the token approach beats
  per-screen colouring.
- PWA UI is CSS/class driven (`.gg-quick-action`, `.gg-bug-fab`,
  `bottom-tab-bar.tsx` inline styles): the nav ink change is one line; the two
  class-based controls are two CSS edits.
- Verification: `npm run typecheck`, frontend vitest, production build (theme
  gate), plus a visual pass on a phone viewport for the PWA surfaces.

**Out of scope / not audited:** the admin console (its own dark design system),
vendored scanner (`components/scan*`), bench prototypes, email/SMS templates.
