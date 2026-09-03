# The Bench — behaviour

A reverse load finder. A member tells it what is on their shelf, and it answers with the loads
they can actually make tonight.

This describes **how the front end behaves**. Nothing here says how the data is stored or served —
for that see `SPEC-BUILD.md`. Where this and the code disagree, the code is what a member
experiences, and one of the two is a bug.

`alloutdoor.co.za/bench` · members only · 3 Sep 2026

**Status key**

| Tag | Means |
|---|---|
| 🟢 **live** | on the box now |
| 🟡 **built** | written and tested, not deployed |
| ⚪ **to build** | agreed, not written |

---

## 1. The model

**Three axes, joined by AND.**

| Powder | Bullet | Cartridge |
|---|---|---|
| what is in the cupboard | weight and calibre | what is chambered |

A load appears only when the shelf has the powder **and** a bullet **and** the cartridge.

Everything else follows from that. A bench holding two of the three returns nothing at all,
however full the other two are — so every empty screen has to say which axis is starving, and
every Add flow has to be reachable.

---

## 2. The shelf

The bench is a list of chips in three groups, each showing its count. On desktop it is a fixed
280px rail; on a phone it is a bottom sheet behind a **My bench** button carrying the three counts.

A chip has **two distinct actions, and they must never be confusable** — one is free, the other is
destructive.

| Gesture | Means | Saves? | Looks like |
|---|---|---|---|
| Tap the chip body | Take it off the shelf **for this search only** | No | Dashed border, grey dot, faded label |
| Tap the remove control 🟡 | Take it **off the bench** | Yes | Its own hit area and its own accessible name |
| Tap the dashed `+ Add` | Open that group's picker | Yes, on choosing | Dashed outline chip, no dot |

> **⚠️ Why the separation is load-bearing.** A member who means *not this search* and gets *deleted
> from my bench* has lost work and has no way to know how to restore it. The remove control needs
> its own hit area — big enough to press deliberately on a phone — and its own name that says what
> leaves ("Remove H4350 from your bench"), never a bare "Remove".

**Removing is immediate and has no undo.** There is no confirmation step — a modal for something
this small is worse than the risk — so the control's separation and its naming are the whole
safeguard. An undoable toast is the open question here.

Removing writes the **whole** bench back, not the one change. A partial write clears the axes it
omits, and an emptied bench looks exactly like a broken one.

> **⚠️ Bench writes are queued.** Every writer builds its body from the bench it can see. Two quick
> removals inside one round trip would otherwise send a second body still carrying what the first
> removed — the chip returns while both toasts say "removed". Nothing errors; what is lost is the
> member's intent, silently, after the screen confirmed it.

---

## 3. Pickers

One per axis. Each opens as a centred panel on desktop and a bottom sheet on a phone, with a search
box that filters as you type. Entries already on the bench show as added and cannot be chosen twice.
Choosing one adds it, closes the picker, and raises a toast naming what was added.

| Picker | A row reads | Search matches on |
|---|---|---|
| Powder | `Varget` · Hodgdon · 1 240 loads | Name and maker |
| Bullet | `.308"` · 150 gr · 1 240 loads | Calibre and weight |
| Cartridge | `6,5 Creedmoor` · 761 loads | Name, ignoring commas, stops and spaces |

> **⚠️ Cartridge names carry a European decimal comma.** The catalogue writes `6,5 Creedmoor` and
> `7,62 x 54 R`. A member is as likely to type a full stop, or nothing at all. All three spellings
> must find it, or the most-loaded cartridge on the site is unfindable.

Every list is complete. Nothing may be capped server-side while the browser does the filtering — a
cap that hides an entry tells a member their powder does not exist.

---

## 4. What a bullet is ⚪

> "A 150gr bullet of any manufacturer would yield almost the exact same pressures and speeds. This
> is the whole point of the Bench." — operator, 3 Sep 2026

A bullet on the bench is a **weight in a calibre**. The maker and the bullet type are shown on every
result, but they never narrow the search — matching on them models the source data rather than the
shelf, and makes the tool nearly useless:

| Bullet axis matches on | Loads for .30-06 + N550 + 150gr |
|---|---|
| maker **and** type (Hornady 150gr SP) | **0** |
| any maker, exact 150gr | **9** |
| any maker, **150gr ± 5** | **17** |

The finder carries a **bullet-weight tolerance** — `0` / `± 5` / `± 10` / `± 15` grains, defaulting
to ± 5. A 145 to 155 grain window is one shelf of bullets to a reloader. The figure is inherited
from the retired Load Lab, which used the same default.

> **⚠️ The tolerance widens the search, never a charge.** Every load is quoted at its own bullet
> weight with its own start and max charge. Nothing on screen may suggest a charge for a 145 grain
> bullet can be used with a 155 grain one. The window decides what a member is *shown*; it never
> decides what is safe to load.

**The calibre still binds.** A 150 gr .277 and a 150 gr .308 are different bullets, and offering one
for the other is the hazard the calibre work exists to prevent. Dropping the maker does not drop the
diameter.

---

## 5. The finder

Controls sit above the results:

- **Cartridge** — `All` plus one pill per cartridge on the bench.
- **Weight band** — `Any` · `≤ 100 gr` · `100–150 gr` · `150 gr +`.
- **Tolerance** ⚪ — how far either side of a bench bullet's weight to look.
- **Units** — `mm` or `inch`. The choice is remembered on the member's bench.
- **Load log** — opens their own logged loads. The button pulses once when a load is logged.

> **🚨 Three of these were decorative until 3 Sep.** The cartridge tab, the weight band and every
> muted chip wrote themselves into the request and nothing read them back. An unread parameter
> throws no error, so the controls moved, the screen redrew, and the results were the same every
> time. **Any control that appears to filter must be shown to change the answer** — a dead control
> is worse than a missing one, because it is trusted.

Changing any control re-runs the search immediately. Results that arrive for a filter the member has
already changed are dropped rather than rendered — out-of-order answers read as the filter being
broken rather than slow.

---

## 6. Results

Cartridge first, with its silhouette drawn from its own published dimensions; then a weight
sub-header; then one row per load. A row carries the bullet, the powder, the start and max charge,
the velocity at each, and the COAL — with a tag when the COAL sits within half a millimetre of the
maximum, or over it.

The panel scrolls inside itself so the controls stay put. Two fixed lines appear on the screen:
`Velocities are indicative only.` once, and the safety line.

---

## 7. Empty and error states

**An empty screen must say why.**

| Situation | What the member sees |
|---|---|
| Loading | Skeleton rows in the results area; the controls stay usable |
| Request failed | What went wrong, and a Retry that re-runs the same search |
| An axis is empty | "A load needs all three: a powder, a bullet and a cartridge." Never "add a powder" to someone who has one |
| All three present, nothing matches 🟡 | The starving axis, with its number: "Your .30-06 and N550 have 70 loads together — but none for the bullets on your bench." |
| Nothing in the catalogue joins them | Say so plainly, rather than implying one more addition would fix it |

This is the difference between a tool that is empty and a tool that looks broken. A correct screen
that explains nothing gets reported as a bug — it already was.

The counts behind that explanation must honour the same filters as the list they explain. A number
taken against the full shelf would credit a powder the member had just switched off.

---

## 8. Load card

Opens as a centred panel on desktop, a bottom sheet on a phone. It carries two large figure tiles —
start charge and max charge — a COAL gauge, and a charge-against-velocity chart whose line joins
only the two published points.

- **COAL gauge** — a track ending at the cartridge's maximum length, with the last half millimetre
  amber. The pin is green when the round is comfortably under, amber when it is close or over.
  Reads `0.13 mm under the maximum · check`.
- **Velocities** — always both units, because a manual prints fps and the range talks m/s.
- **Actions** — `Log this load`, `Cartridge spec`, share.
- **Footer** — the safety line, on every card.

---

## 9. Cartridge spec

A right-hand sheet on desktop; a full-screen push with its own back header on a phone. Three views —
`2D`, `3D lathe`, `Half section` — over a drawing derived entirely from the cartridge's own published
dimensions.

Nothing is drawn by eye, and where a dimension set is incomplete the drawing is **withheld** rather
than guessed: a partial set renders a confident, wrong cartridge.

Hovering a row in the Dimensions table lights its letter on the drawing, and hovering a letter
lights the row. The **For the reloader** section compares chamber against cartridge — and where a
chamber figure is not published it prints a bracketed placeholder, exactly as
`[chamber L2] vs 41.52 mm`. **A chamber figure is never computed.**

The 3D view loads on first use only, and falls back to the 2D drawing wherever it cannot run.

---

## 10. Load log

Logging pre-fills from the load — cartridge, bullet and powder read-only; charge defaulting to the
start charge; COAL, primer, case and date editable.

Warnings appear live as the charge is typed — `ABOVE MAX 41.5`, `BELOW START 35.6` — but they
**warn and never block**: a legitimate workup goes outside the published window, and a tool that
refuses to record what someone actually fired is a tool they stop using.

The log lists every entry with delete, and exports to CSV. The export is complete — never a capped
slice of someone's own record.

---

## 11. Words

Two strings are verbatim and identical everywhere they appear:

- `Work every load up from the start charge while watching for pressure signs.` — on the results
  screen and every load card.
- `Velocities are indicative only.` — once, on the results screen.

> **⚠️ No surface may name where a figure came from.** Not in a label, a tooltip, a title or a
> screen-reader name. The vocabulary is *start charge*, *max charge*, *Dimensions*, *Pmax*, and
> *the maximum* for COAL. Powder and bullet **maker** names — Hodgdon, Hornady, Somchem,
> Vihtavuori — are product facts and stay.

---

## 12. Shape

| Width | Layout |
|---|---|
| ≥ 1024px | Tool bar, 280px bench rail beside a results panel that scrolls internally. Overlays are centred panels and a right-hand sheet |
| 768–1023px | The rail collapses into the **My bench** sheet; results take the full width |
| < 768px | Tool strip, results, safety line. Overlays become bottom sheets; the spec card becomes a full-screen push |
| Installed app | As the phone, inside the app shell's own header and tab bar |

Overlays stack: the log sheet opens over the load card. **Escape closes only the top one**, and
closing returns focus to whatever opened it.

---

## 13. Where this stands

| Behaviour | State |
|---|---|
| Three pickers, add to bench | 🟢 live |
| Bullet carries its calibre | 🟢 live |
| Cartridge drawing and dimensions | 🟢 live |
| Chip mutes for one search | 🟡 built |
| Cartridge tab and weight band actually filter | 🟡 built |
| Remove from the bench | 🟡 built |
| Empty result names the starving axis | 🟡 built |
| Bullet matches on weight, not maker | ⚪ to build |
| Bullet-weight tolerance control | ⚪ to build |
