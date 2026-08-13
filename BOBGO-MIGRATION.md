# Bob Go — replacing Pudo + TCG

Working document. Bob Go is an aggregator offering **both** door-to-door and Bob
Box locker delivery through one API, one wallet and one tracking vocabulary. It
replaces Pudo (lockers) and The Courier Guy (door).

Everything below marked *verified* was observed against the live sandbox on
**2026-08-13**.

**Correction (same day):** an earlier note here said the sandbox had no courier
that accepts a shipment. That was wrong, and it was wrong in an important way.
The sandbox has **two** providers and they behave differently:

| `provider_slug` | Behaviour |
|---|---|
| `sandbox` (door rates) | **Accepts.** `pending-rates` → `success` |
| `demo` (pickup-point rates) | Refuses. `pending-rates` → `no-rates` |

Shipment **16625** was accepted end to end. That single fact answered several
questions this document previously listed as unanswerable.

---

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Enum migration | **No.** `PUDO` becomes the *pickup-point slot*, `TCG` the *door slot* | Avoids an enum migration across ~38 files, every courier cron filter and the consolidation rules |
| Rollout | Runtime flag `bobgo_enabled`, default OFF, admin-flippable, marked `danger` | It swaps the rail carrying every parcel and spends real money; flipping back mid-incident must not need a build |
| Provider routing | New `Transaction.carrierProvider` column | Post-booking ops must route on the **actual** carrier, not the slot |
| Client failure mode | Throws on outage rather than returning null | Callers must be able to tell "no rates" from "Bob Go is down" |

**Consequence of the slot decision:** the enum values now describe the *shape*
of the delivery, not the company carrying it. Anything reading `shippingMethod`
to mean "Pudo" or "The Courier Guy" is now wrong. That is the price paid for not
migrating, and it is why `carrierProvider` exists.

---

## The central hazard

**Bob Go returns HTTP 201 for shipments the courier then refuses.** Sandbox
shipment 16623 came back created, with `app_status: "completed"`, while also
carrying `submission_status: "no-rates"` and `failed_reason: "No valid rates
received from Demo Couriers"`.

**And it is worse than an edge case: a 201 is NEVER a confirmation.** Both
bookings — the one that succeeded and the one that failed — came back
`pending-rates` at create time and only resolved seconds later. So *every* Bob
Go booking starts unconfirmed. The resolution sweep is not a safety net for a
rare failure; it is the normal path by which a booking becomes real.

Pudo and TCG were both booked-or-throw. **Every caller in the codebase assumes
that a create call which returned means a courier is committed.** Unpicking that
assumption is the bulk of the remaining work.

`classifySubmission()` is a fail-closed allowlist: only
`submitted / success / successful / accepted` count as booked. `"completed"` is
deliberately excluded, because that is the exact word the *failed* shipment used.

Both halves of that are now **verified rather than merely cautious**:

- The real success token is **`success`** — already on the allowlist.
- `app_status` is **`active`** on the accepted shipment and **`completed`** on
  the refused one. "Completed" really does mean "we finished processing (and
  said no)".
- The allowlist met an unseen status, **`pending-rates`**, and correctly failed
  closed to PENDING rather than guessing.

---

## Done

- `backend/src/shipping/bobgo.service.ts` — client. Rates, locations,
  create, re-read, tracking. Inert without `BOBGO_API_KEY`; warns at boot when
  pointed at the sandbox.
- `backend/src/shipping/bobgo.types.ts` — shapes, each annotated verified or not.
- `backend/src/shipping/bobgo-adapter.ts` — slot mapping, rate selection,
  rand→cents, and the rates-driven pickup-point picker.
- `bobgo_enabled` flag in both registries (runtime + admin, `danger: true`).
- Migration `20260813000000_transaction_bobgo_rate_snapshot` —
  `shippingProviderSlug`, `shippingServiceLevelCode`, `carrierProvider`.
- Parcel/declared-value consolidation hoisted out of the TCG branch so both
  slots share one definition of what is in the box.

**Booking seam (increment 3):**

- `CarrierShipmentResult` widened with `provider` and `submission`; Pudo and TCG
  declare `SUBMITTED` explicitly, since for them returning at all was always the
  confirmation.
- `bookForTransaction` now branches three ways. `FAILED` throws into the existing
  catch (claim released, admin alerted, seller told to dispatch manually);
  `PENDING` records the shipment id and provider but leaves `shipmentBookedAt`
  null, notifies nobody, and **holds** the claim so nothing double-books.
- `resolvePendingBobGoBookings()` + a 5-minute cron finishes those rows — ONE
  Bob Go request per tick regardless of row count. An outage touches nothing.
- `cancelForTransaction` gates on the shipment id rather than the booked stamp,
  so a pending shipment on a reversed sale is no longer silently skipped, and
  routes on `carrierProvider`. Bob Go has no cancel API, so it raises an
  explicit operator alert instead of a quiet failure.
- Waybill download refuses until `shipmentBookedAt` is set.
- The rate snapshot is now WRITTEN on all three paths (single checkout,
  consolidated cart, both swap legs) — the columns existed but nothing filled them.
- 137 shipping tests; 999 backend tests green.

---

## Remaining work, by seam

Ordered by how much damage the hazard does if shipped unfixed.

### 1. Booking — the success-on-return assumption ✅ DONE (increment 3)

Kept here for the record. `shipping.service.ts:756-764` stamped `carrierShipmentId`, `carrierDropoffPin`,
`trackingReference` and `shipmentBookedAt` the moment the create call resolves.
`:796` then fires `notifications.shipmentBooked`, whose SMS is sent
`{ critical: true }` — it **bypasses the seller's SMS mute**. So the one message
guaranteed to reach the seller's phone is the false one.

Required: three-way branch on `submission`.

- `SUBMITTED` → today's behaviour, plus `carrierProvider = 'BOBGO'`.
- `FAILED` → **throw**. The existing catch at `:811-824` already does the right
  thing: releases the booking claim, raises an admin alert, and tells the seller
  to arrange dispatch manually. Reuse it rather than building a second path.
- `PENDING` → a state the schema has never had. Persist `carrierShipmentId` so
  the shipment can be polled and cancelled, but leave `shipmentBookedAt` null
  and notify nobody. Needs a resolution cron.

Watch: `cancelForTransaction` (`:843`) early-returns when `shipmentBookedAt` is
null, so a PENDING shipment left deliberately unstamped would silently skip
cancellation. That guard has to learn about the third state at the same time.

The resolution cron must fetch the shipment list **once per tick** and match
locally. Calling `getShipment` per row re-downloads the account's whole shipment
list per row, because the `?id=` filter has never been observed to work.

### 2. Quoting ✅ DONE (increment 5)

`quoteForListing` and `quoteCombined` both route through one shared helper when
the flag is on. A single `getRates` call serves BOTH slots — door rates fill the
TCG slot, pickup-point rates the PUDO slot — replacing two carrier calls.

**Outage and no-rate are now different answers.** Both legacy clients returned
null for everything, so "no rate for this route" and "the carrier is down" were
indistinguishable: the buyer saw an empty shipping list either way and the sale
was lost silently. Now an outage tells the buyer to retry, and a genuine
no-rate says so. `quoteCombined` still returns **null for everything including
an outage**, because `createOrderCheckout` calls it with no try/catch and treats
null as "fall back to per-line quoting" — a throw there would 500 a whole cart.

The rate snapshot (provider + service level) is written on all three paths, and
`bobgoPickupPoints()` + `POST /shipping/pickup-points` serve the inverted
picker: priced, deduped, nearest-first points built from the quote itself.

**The UX change is now enforced in code**: the pickup-point slot demands a
delivery address and says so plainly. Frontend still to follow.

Declared-value units were a live trap and are fixed: the client takes cents and
converts on the wire. Passing rand would have declared a R1,500 parcel as
R150,000.

### 3. Tracking ✅ DONE (increment 6)

Bob Go gets its **own** status table in `status-map.ts`, kept apart from the
Shiplogic one rather than bolted onto it. Two words collide with meanings we
must not inherit:

| word | Shiplogic reading | correct for Pudo? | if Bob Go sent it |
|---|---|---|---|
| `ready-for-pickup` | → AT_LOCKER → OUT_FOR_DELIVERY | yes | buyer told "out for delivery" for a parcel that may not have moved, then pinned there by the backward-transition guard |
| `expired` | → PIN_EXPIRED → **DELIVERY_FAILED** | yes | a TERMINAL failure written, buyer notified, admin alert raised |

Both now return **null** on the Bob Go table — recorded, never applied. Entries
are labelled OBSERVED vs CANONICAL so the difference between evidence and
inference stays visible.

`tracking/updated` webhooks now advance the order through
`applyShippingUpdate` — the same entry point the poll and both legacy webhooks
use, so all three share one decision about backward transitions, notifications
and the delivered/payout gate.

**And a live bug fixed:** a Bob Go pickup-point order has `shippingMethod
PUDO`, so the Pudo poll would have queried Bob Go waybills against Pudo's API —
a permanent 404. `fetchTrackingEvents` returns null on 404 and the loop just
`continue`s, so there would be no error, no alert and no log line: the rail
would have gone blind while every downstream state silently stopped advancing.
Bob Go rows are now excluded from that poll.

### 3b. Original analysis — an unknown vocabulary meeting a lexical map

`status-map.ts` collapses on substrings, and Bob Go's status strings are unknown.
Two collisions are live:

- `READY_FOR_PICKUP` / `AT_LOCKER` (`:86-89`) maps to `OUT_FOR_DELIVERY`
  (`:120`). Bob Go has an explicit `ready_for_pickup` movement event. The buyer
  would be told "out for delivery" for a parcel sitting in a locker — and the
  backward-transition guard then pins it there.
- `EXPIRED` → `PIN_EXPIRED` → `DELIVERY_FAILED` (`:100`, `:125`). "expired" is a
  very plausible Bob Go string for something benign; it writes a terminal
  failure state and raises an admin alert.

Also: `fetchTrackingEvents` is null-on-failure by design and the poll loop
`continue`s. The Bob Go client throws, so one stale reference would break out of
the whole loop and stall the sweep for every parcel.

**Do not map Bob Go statuses by pattern.** Only map strings actually observed;
everything else is "unknown, leave the state alone".

### 4. Lockers — the flow inverts

Today: search a cached Pudo directory, pick a terminal, then price it. Bob Go
returns pickup points already priced, already distance-ranked and already
bookable — the location id is baked into the `serviceCode`. So it becomes: quote
the route, then pick from the answers.

Better in one way — every option shown is one Bob Go has confirmed it will carry
this parcel to, which the Pudo directory could never promise. Worse in another —
**the buyer needs a delivery address before seeing any locker**, where today they
can browse first. That is a real checkout UX change and needs an operator call.

The whole Pudo directory + Voronoi postal-code ranking (`pudo.service.ts:105-179`,
`postal-codes.service.ts`, the `pudo_lockers` Meili index) exists only because
Pudo has no server-side proximity query. Bob Go has one. That machinery can
retire — but not before the picker is rebuilt.

`Transaction.pudoPickupLockerId` would hold two incomparable id namespaces
(Pudo's `CG929`, Bob Go's `545`). Admin surfaces render it raw under Pudo labels.

### 5. Waybill and cancel

`transactions.service.ts:2741` streams a waybill whenever `carrierShipmentId` is
non-null. Under Bob Go a refused shipment still has an id, so a seller could
print a real-looking label and tape it to a box no one will collect.

**Unknown whether Bob Go exposes a label endpoint or a cancel endpoint at all.**
Without cancel, every reversed sale becomes manual operator work, and the
auto-refund sweep (`dispatch-sla.service.ts:200`) would leave live waybills on
refunded orders.

### 6. Seller fairness ✅ DONE (increment 6)

A seller is no longer struck when the platform never gave them a shipment to
send — a Bob Go booking the courier refused, or one still unaccepted. In both
cases there is no waybill and no PIN; they could not have dispatched if they
wanted to. The refund and restock still happen (the buyer must not be left
holding a sale that will never ship) — only the blame is withheld.

Deliberately narrow: any row where a booking genuinely completed, and every row
on the legacy rails, is the seller's responsibility exactly as before. Widening
it beyond our own carrier failures would hand every late seller a free excuse.

### 7. Copy

Every user-facing "Pudo" / "The Courier Guy" string needs rewriting — seller SMS
and email (`notifications.service.ts:1592, 1614, 1640`), the dispatch panel
(`dispatch-button.tsx:137-201`), admin labels. Not a rename if there is no PIN:
the entire locker hand-over instruction changes shape.

---

## Webhooks

Seven topics exist. The API will not tell you this directly — it lists them in
the error when you send an invalid one:

```
fulfillment/created
shipment_submission_status/updated     <- resolves a PENDING booking in seconds
tracking/updated                       <- the real status vocabulary
shipment_charged_amount/updated        <- what we are actually billed changed
shipment_charged_weight/updated        <- they re-weighed the parcel
shipment_health_status/updated         <- e.g. warning-late-collection
order/updated
```

**Receiver is BUILT and DEPLOYED** (`576ca77`), inert until subscriptions
exist. `POST /api/shipping/webhook/bobgo/<secret>/<group>/<action>` — the topic
AND the secret travel in the path, because subscriptions are registered one
topic at a time and *we* choose the URL, so each one self-identifies and
authenticates without relying on custom-header support we have not verified.
Verified live: routes, returns 200, rejects a bad secret, fails closed when
`BOBGO_WEBHOOK_SECRET` is unset in production.

Payloads land whole in `BobGoWebhookEvent`. The receiver applies ONLY statuses
it has actually observed and logs everything else loudly — that table is the
evidence `status-map.ts` should be widened from.

### Registered and PROVEN LIVE (2026-08-13)

All five subscriptions are **Active** on the sandbox account, registered in the
portal. A single booking (shipment 16626) produced **five webhook deliveries in
four seconds**, all captured in `BobGoWebhookEvent`:

```
shipment_submission_status/updated   16626      pending-submission
shipment_charged_amount/updated      16626
shipment_submission_status/updated   16626      success
shipment_health_status/updated       16626      warning-late-collection
tracking/updated                     UASSW3HJ   pending-collection
```

**The vocabulary is no longer guesswork.** Bob Go's own `tracking_steps` object
enumerates the lifecycle it models:

| step | key | our ShippingStatus |
|---|---|---|
| 1 | `created` | PENDING |
| 2 | `collected` | COLLECTED |
| 3 | `in-transit` | IN_TRANSIT |
| 4 | `out-for-delivery` | OUT_FOR_DELIVERY |
| 5 | `delivered` | DELIVERED |

It maps one-to-one onto the existing enum. Note there is **no ready-for-pickup
step on a door shipment** — that stays unmapped until a locker booking succeeds.

Two more things the live events taught us:

- **A fourth submission status: `pending-submission`** (after `pending-rates`,
  `success`, `no-rates`). The fail-closed allowlist handled it correctly
  without a code change, which is the design working as intended.
- **On `tracking/updated`, and only there, `id` is the TRACKING REFERENCE**
  (`UASSW3HJ`), not the numeric shipment id the other four topics send. That is
  convenient — `Transaction.trackingReference` is what the poll already matches
  on — but it means a query by numeric id will not return a shipment's tracking
  rows.
- There is a **public tracking page**: `https://track.sandbox.bobgo.co.za/<ref>`.

Bob Go can also **sign payloads** — a `bobgo-webhook-signature` header, keyed on
a secret generated in the portal. Not yet enabled; the path secret is doing the
authentication today. Worth upgrading to HMAC verification.

### How registration works (the API route is a trap)

The create contract was reverse-engineered to
`{ topic, delivery_url, status: "active"|"inactive" }` — each field name came
out of an error message (`Invalid delivery url.`, then
`Unsupported status. Possible values are: active,inactive.`).

With all three fields valid:

| Verb | Result |
|---|---|
| `POST /webhooks` | **200, body `null`, creates nothing.** `count` stays 0. |
| `PATCH /webhooks` | 404 — it updates an existing subscription, and there are none |
| `PUT /webhooks` | 405 |

So the sandbox accepts a webhook-creation call and does nothing with it. **This
is the third time Bob Go has returned a success-shaped response that isn't** —
after the 201 for refused shipments and `app_status: "completed"` on a failure.
It is a pattern worth assuming holds elsewhere in their API.

Registration therefore has to happen in the **portal** (Settings → Webhook
subscriptions), which is where the five above were created. The poll remains as
the backstop for anything the webhook misses.

---

## Who chooses the delivery option

**Operator decision, 2026-08-13: the delivery option is the BUYER'S to decide.**

The seller no longer curates door versus collection point. What still is not
the buyer's call — because it is law, physics or a genuine seller constraint:

- firearms are dealer-transfer only (absolute)
- collection-only and dangerous-goods items stay collection-only
- a seller who offered **no** courier at all is respected absolutely
- a parcel too big for a locker never comes back with a pickup-point rate,
  because Bob Go is size-aware — the limit enforces itself rather than needing
  the seller to police it

`POST /shipping/delivery-options` returns the whole menu in one call — the door
option and every nearby collection point, priced and distance-ranked — so the
buyer picks from what Bob Go will actually carry.

### Why this is gated on the Bob Go rail

On the LEGACY rail the seller's pick is **not** a preference between two
deliveries; it describes their own hand-over. `PUDO` means they drop at a locker
and may have no pickup address at all. `TCG` means a courier comes to them.
Letting a buyer pick PUDO on a TCG-only listing would quote a locker drop the
seller never agreed to; picking TCG on a PUDO-only listing would quote against a
pickup address that does not exist.

Bob Go removes that distinction — it collects from an address either way — which
is precisely what makes the choice the buyer's to make. So the rule applies only
when the flag is on, and there is a regression test pinning the legacy behaviour.

### What this leaves outstanding

- **The sell form still asks.** Sellers are shown Pudo/TCG pills whose answer
  the Bob Go rail now ignores. It cannot simply be removed, because the same
  form drives the live legacy rail where the answer still matters — so it needs
  to become flag-aware, not deleted.
- **Every courier listing now needs a pickup address.** `pickupStreet` is
  optional today, so locker-only listings may have none; under Bob Go those
  cannot be quoted at all. Needs a count against production and a seller nudge
  before the flag flips.

---

## Failed shipments, rebooking, and who pays

**Operator rule, 2026-08-13:** when a shipment fails because the seller got it
wrong — most often a parcel measured smaller than it really is, which then does
not fit the collection point — the wasted courier charge is theirs. They rebook,
and the amount comes off what they are paid for the sale.

Reasons are a fixed ticklist (`common/shipment-failure-policy.ts`), exposed at
`GET /shipping/failure-reasons` so the admin UI cannot keep a copy that drifts.

| Seller pays | No charge |
|---|---|
| Parcel too large / overweight | Collection point full |
| Nobody available at collection | Buyer unreachable / wrong delivery address |
| Collection address wrong | Courier error, parcel lost or damaged |
| Parcel not packed and ready | **Other** |

Two judgement calls worth stating:

- **A full collection point is not the seller's fault.** It looks like a parcel
  that did not fit, but they could not have prevented it.
- **"Other" never charges.** It is the reason picked when nobody is sure, and
  money should not move on an unexplained failure.

### How the money is applied

The charge accumulates in `Transaction.failedShipmentChargeCents` and is
subtracted in `netPayoutCents()` where payouts are computed. **`sellerPayout` is
never mutated** — it is a point-of-sale snapshot of what buyer and seller
agreed, so the deduction stays a separate, explainable line rather than silently
rewriting the sale. Clamped at zero: recovering more than the sale is worth is a
decision for a human, not something a payout run should do.

The amount is the carrier rate (`shippingCost`), NOT including GG's own
handling margin — we did not lose our margin to the carrier, and billing it on
top would charge twice for one mistake.

⚠️ Both payout queries must select `failedShipmentChargeCents`. Omit it and the
deduction is silently zero, which looks exactly like a working payout.

### Rebooking

`rebookShipment()` clears the dead booking and hands back to
`bookForTransaction`, which stays the only thing that ever books — so the
idempotency claim and the three-way submission handling live in one place.

It **refuses until the listing has actually been re-measured** (updated *after*
the failure) when the failure was a size or weight error. A parcel that did not
fit will not fit the second time; rebooking without corrected measurements just
burns another courier charge — theirs — and delays the buyer again.

The failure reason, note and accumulated charge are deliberately NOT cleared on
rebook. They are the record of what happened and why the seller is being billed.

---

## The checkout seam

`POST /shipping/delivery-options` is **rail-agnostic**: it answers from Bob Go
or from Pudo+TCG depending on the flag, in one shape.

That is the seam that hides the whole migration. The frontend has no way to read
a feature flag and is deliberately not given one — exposing it would make the
checkout care which carrier we use, and the entire point of the slot design is
that it does not have to. Written this way, the buyer's UI is built once and the
carrier swap needs no frontend release.

The two rails genuinely differ underneath, and the difference is the argument
for migrating:

| | Legacy (Pudo + TCG) | Bob Go |
|---|---|---|
| Calls | TCG quote **+** locker directory **+** L2L quote | one `getRates` |
| Point prices | one flat L2L rate for every locker | per-point, real |
| Fit checked | no — discovered at drop-off | yes, size-aware |
| Points offered | whatever the directory lists | only ones that will take **this** parcel |

`components/delivery-options-picker.tsx` renders it: one radio list mixing door
and collection points, each with its own price and distance, keyed on the
`serviceCode` that gets replayed at booking. It distinguishes three states that
used to look identical — loading, "we could not ask" (retryable), and "the
courier does not serve this parcel to that address" (not an error).

**Still to wire:** the checkout form itself still uses the old method cards plus
the directory-backed locker picker. That edit is deliberately not done blind —
it is a live money path and wants a working local stack or a staging flip to
verify against, not a hopeful patch.

---

## Open questions

### Answered by the accepted shipment (16625)

| Question | Answer |
|---|---|
| Does the sandbox accept anything? | **Yes**, via provider `sandbox` (door). `demo` (pickup-point) still refuses. |
| What is the real success token? | **`success`**. Already on the allowlist. |
| Is "completed" safe to treat as booked? | **No.** `app_status` is `active` on success, `completed` on refusal. |
| Does the quoted price match the charge? | `charged_amount` **114.95** = the quoted `total_price`. But `final_charge_applied` is **false**, and `charged_weight_kg` was rounded **2.5 → 3**, so a re-weigh can still move it across a rate band. `pricingVerified` stays false. |
| Is there a printable label? | **No label/PDF field on an accepted shipment.** The seller writes the reference on the parcel. |
| Tracking vocabulary? | Begins `pending-collection` / "Pending collection", courier `Sandbox Couriers`. Movement keys are `*_time` and unset ones are **empty strings** — a client bug this found and fixed. |
| Is there a collection reference? | `collection_reference` = the tracking reference. No PIN on a door shipment (expected). |

Also learned: `provider_shipment_id` carries the courier's own id, and
`health_status` exists (`warning-late-collection` on an uncollected parcel) —
a ready-made signal for the stalled-parcel sweep.

### Still open — for Bob Go

1. **Locker PIN.** Still unproven, and now harder: the only pickup-point rates
   the sandbox offers come from `demo`, which refuses every booking. We need a
   pickup-point booking that actually succeeds.
2. **Western Cape locker coverage** — the sandbox has none.
3. **Cancel endpoint.** None found. Without it every reversed sale is manual
   operator work.
4. **Webhook** — payload and auth model.
5. Does a refused booking consume wallet credit? Decides the retry cap.
6. Is `total_price` VAT-inclusive? Still unconfirmed, and a ~15% hole if not.

### Still open — for the operator

1. The locker picker now needs a delivery address first. Acceptable?
2. Should a refused booking auto-retry against the other rate type (door when
   the pickup point refuses)? It silently changes what the buyer paid for and
   where the parcel goes — worth an explicit decision, not a default.
3. One flag for both rails, or separate flags so door and lockers can migrate
   independently? The sandbox split (door works, pickup-point does not) is a
   concrete argument for two.
