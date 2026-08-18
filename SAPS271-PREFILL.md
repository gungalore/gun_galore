# Pre-filling the SAPS 271

*Analysed 2026-08-18 from the current SAPS 271 (12 pages).*

## Can we fill it? Yes — by overlay, not by rebuilding

**The form has ZERO AcroForm fields.** I checked with pdf-lib: 12 pages, no fillable
fields. So it cannot be filled the easy way (`setText` on a named field).

It CAN be filled the way this codebase already fills the SAP 534 in production
(`backend/src/payments/saps534.service.ts`): load the original PDF, draw text at absolute
coordinates on top of it, save. The original pages are preserved exactly — nothing is
recreated, redrawn or rebuilt, so what the DFO receives is the real SAPS form with our text
in the boxes.

Cost: a one-time measuring pass per field (x, y, page, max width). After that it fills in
milliseconds. `saps534.service.ts` already carries the two helpers this needs — the
candidate-path asset loader and a shrink-to-fit `put()` for tight boxes.

**⚠️ The signature block is never filled.** The operator's own guidance is explicit:
*"Moet nie SAPS vorms teken nie — dit moet voor die DFO gedoen word."* We pre-fill and
leave every signature and date-of-signature blank. The checklist says so.

**⚠️ Sections A, B and C are OFFICIAL USE ONLY** (police station capture, CFR decision,
reasons for refusal). We never touch them.

---

## What the form asks, and where it comes from

### Already collected — fills straight away

| SAPS 271 | Our source |
|---|---|
| D.3 — section applied for (13/14/15/16/17/19/20) | `licenceType` |
| Surname · Initials · Full names | `full_name` (split in code) |
| Identity number | `id_number` |
| Residential address + postal code | `residential_address` |
| Trade or profession | `occupation` |
| E-mail address | the account |
| Association / dedicated-status details | `association_name`, `association_number`, `dedicated_since` |

### Derivable — never ask for these

The SA ID number carries them, so asking would be both redundant and a chance to introduce
a contradiction between two fields on the same form:

| SAPS 271 | Derived from |
|---|---|
| Date of birth | ID digits 1–6 |
| Age | ID + today |
| Gender | ID digits 7–10 (0000–4999 female, 5000–9999 male) |
| Citizenship indicator | ID digit 11 (0 = SA citizen) |

### NOT yet collected — the gap this analysis found

**Personal:**
`postal_address` (where it differs from residential) · `residence_type` (house, flat,
cottage, smallholding…) · `home_telephone` · `work_telephone` · `employer_name` ·
`employer_address` · `marital_status` · `spouse_name` + `spouse_id_number` (asked whenever
married).

**Structured firearm details.** This is the significant one. Our registry has
`firearm_description` as a single free-text field, and the form wants each part in its own
box: **type** (rifle / shotgun / handgun / combination) · **action** (semi-automatic,
automatic, bolt, lever, pump, single-shot, revolver) · **make** · **model** · **calibre** ·
**serial number** · barrel length. Free text cannot fill separate boxes, and the same
breakdown is what the EXISTING FIREARMS comparison needs anyway.

**The six history questions.** Every one is YES/NO with details if yes, and they are the
part of the form applicants most often get wrong:

1. Ever convicted of an offence, inside or outside the RSA?
2. Any cases pending against you?
3. Have any of your firearms ever been lost or stolen?
4. Was a case of negligence opened regarding a lost/stolen firearm?
5. Have you ever been declared unfit to possess a firearm?
6. Has a firearm in your possession ever been confiscated?

Each wants police station, CAS number, charge and outcome. We collect none of it today —
`prior_refusals` touches only the edge of question 5.

**These matter beyond the form.** A disclosed and explained conviction is survivable; an
undisclosed one that surfaces later is fatal, and it is exactly the kind of thing a
motivation should address head-on rather than leave for the Registrar to discover. Asking
them in the wizard therefore improves the *motivation*, not just the form.

### Not applicable to our applicants

Type B (dealers), Type C (companies), Type D (imports), Type E (estates), juristic persons,
SAP 350(A). Private applicants only — leave blank.

---

## What this changes

**Done** (`b76e0e3`):

1. ✅ **`firearm_description` split** into `firearm_type` / `firearm_action` / `firearm_make` /
   `firearm_model` / `firearm_calibre` / `firearm_serial` / `barrel_length`. Fully automatic is
   absent from the action list on purpose — it is not licensable to a private person, so it
   must not be selectable on a form we help someone sign. The serial is optional: on a new
   application the dealer still holds the firearm.
2. ✅ **Personal fields added** — `postal_address`, `residence_type`, `home_telephone`,
   `work_telephone`, `employer_name`, `employer_address`, `marital_status`, and spouse details
   that appear only when married.
3. ✅ **The six history questions**, each yes/no + detail, none defaulting to "No".
4. ✅ **DOB, age, gender and citizenship derived** from the ID (`sa-id.ts`), never asked.

Two mechanisms came out of it and are worth knowing about:

- **`showIf`** — a conditional field is not "unanswered", it does not apply. `missingRequired`
  no longer demands spouse details from someone single, or the detail of a conviction from
  someone with none.
- **`formOnly`** — collected for the form, never shown to the writer. Contact numbers and a
  spouse's ID are PII with no argumentative value; and six "No" answers to the history
  questions would be padding fuel for exactly the sentences ABSOLUTE RULE 7 bans. Where an
  answer is "Yes" the linked detail field is *not* form-only, so a disclosure reaches the
  writer in full.

**Remaining:**

5. ⬜ **A coordinate map** (`saps271-coords.ts`), measured once against the real PDF, plus the
   fill service. `saps534.service.ts` already carries both helpers this needs — the
   candidate-path asset loader and a shrink-to-fit `put()` for tight boxes.
6. ⬜ **The blank form as a repo asset**, the way `assets/saps534-blank.pdf` already is.
   ⚠️ Confirm we are shipping the current revision before go-live; the checklist already
   marks the form reference `verifyBeforeUse`.

Roughly **40 of the ~55 boxes a private applicant must complete** become automatic. The
remainder are the ones only they can answer — marital status, spouse details, history answers —
and those are single taps in the wizard, not paperwork.
