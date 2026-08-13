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

### 2. Quoting — units, and fail-soft

- `quoteCombined` (`transactions.service.ts:1002`) has **no try/catch** and its
  only error contract is `return null`. Since the Bob Go client throws, one
  unreachable call turns a whole multi-item cart checkout into a 500 instead of
  the designed silent fallback to per-line quoting.
- Both `BadRequestException` branches at `shipping.service.ts:229` and `:295`
  become unreachable for the same reason, and their copy is wrong under Bob Go
  ("too large for Pudo locker shipping" also fires when there is simply no
  pickup point near the address).
- The consolidated-cart override tuple (`transactions.service.ts:966`) and both
  swap legs (`swap-funding.service.ts:312-331`) snapshot **only**
  `serviceCode` — they must also carry provider and service level, or the
  booking days later goes out with a guessed provider.

Declared-value units were a live trap and are **already fixed**: the client takes
cents (`declaredValueCents`) and converts on the wire, matching what every caller
already passes. Passing rand would have declared a R1,500 parcel as R150,000.

### 3. Tracking — an unknown vocabulary meeting a lexical map

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

### 6. Seller fairness

`dispatch-sla.service.ts:118` auto-refunds undispatched orders, increments
`dispatchStrikes`, and queues the seller for suspension review at three. Nothing
distinguishes "seller ignored it" from "our booking was silently refused". Bob Go
submission failures would be **charged to innocent sellers as strikes**. This one
is a fairness bug, not just a technical one.

### 7. Copy

Every user-facing "Pudo" / "The Courier Guy" string needs rewriting — seller SMS
and email (`notifications.service.ts:1592, 1614, 1640`), the dispatch panel
(`dispatch-button.tsx:137-201`), admin labels. Not a rename if there is no PIN:
the entire locker hand-over instruction changes shape.

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
