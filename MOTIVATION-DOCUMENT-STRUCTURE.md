# What a real SA firearm-licence motivation looks like

*Derived 2026-08-18 from eight real motivations supplied by the operator (two different
authors, s13 self-defence and s16 dedicated-status, handgun / shotgun / rifle).*

**No applicant content appears in this file.** The source documents contain third parties'
ID numbers, addresses and firearm serials. They are NOT in the repo and must never be.
What follows is structure, section ordering and argument shape only.

---

## The headline finding: it is a BUNDLE, not a letter

Every sample runs **11 to 40 pages**. The Phase 1 design assumed a 2–4 page prose document.
That was wrong, and it is the single biggest correction the samples produced.

A motivation is a **compiled submission**: a cover page, a table of contents, a running
header on every page, ~10 argued sections, a PAJA request, a conclusion, and a numbered
annexure list — with the evidence bundle attached behind it.

**This maps directly onto the scan/upload feature.** The uploads ARE the annexures. Scanning
an ID does not merely prefill a field; it becomes *Annexure A*, gets listed in the annexure
index, and gets cross-referenced from the body. That is a much stronger product than
prefilling a form.

---

## Two schools, both valid

### A. The compiled/professional style (paid-service look)

- **Cover page**: applicant name, ID, contact, email; then a firearm block — type,
  manufacturer, calibre, serial, model.
- **Table of contents**, with page numbers.
- **Running header on every page**: `Page N of M — Motivation for <name> for a <make>
  <type> Serial Number: <serial> for <purpose>.`
- Section order (consistent across all four samples of this school):
  1. `PERSONAL DETAILS`
  2. `FIREARM EXPERIENCE`
  3. `CURRENT COMPETENCY STATUS`
  4. `SECURITY AND SAFE STORAGE FACILITY`
  5. `ASSOCIATION MEMBERSHIP AND STATUS`
  6. `FIREARM APPLIED FOR` (with `SPECIFICATIONS` / feature sub-headings)
  7. `THE CALIBRE`
  8. `EXISTING FIREARMS`
  9. `COMPARISON`
  10. discipline content — `SPORT SHOOTING THE <ASSOCIATION> WAY`, the **rules and scoring
      of the specific exercises** the applicant shoots
  11. `PROMOTION OF ADMINISTRATIVE JUSTICE ACT`
  12. `CONCLUSION`
  13. `LIST OF ANNEXURES THAT FORMS PART OF THIS MOTIVATION`
- **Inline annexure cross-references** after nearly every factual claim:
  `(Refer to Annexure A: Copy of ID document of applicant)`.
- Annexure set observed: A ID · B proficiency certificate · C competency certificate ·
  D address confirmation · E employment confirmation · … I character references.

### B. The personal/direct style

- Name + ID + cell as a header/footer band on every page (signature block styling).
- Addressed explicitly: *The Commanding Officer, SAPS: Central Firearms Register, Pretoria*.
- `Personal Information` block, then continuous narrative.
- Shooting-exercise descriptions named after the association's actual exercises.
- Shorter (11–16 pages), noticeably more personal voice, some Afrikaans vocabulary retained.
- The SAPS application form itself is bound into the same PDF.

---

## The arguments that actually do the work

These are the load-bearing moves, in rough order of how much weight they carry:

1. **EXISTING FIREARMS + COMPARISON.** For an additional firearm this is the crux: what the
   applicant already owns, and why the new one is *not* a duplicate. Pre-empts the obvious
   refusal ground. A motivation for an additional firearm without this section is weak.
2. **THE CALIBRE.** A dedicated section justifying the calibre against the stated purpose —
   quarry size and terrain for hunting; discipline rules and target distances for sport.
3. **Discipline rules and scoring.** Reproducing the actual rules of the exercises the
   applicant competes in demonstrates genuine participation rather than claimed
   participation. Distinctive and persuasive.
4. **Evidence cross-referencing.** Every claim points at an annexure. Assertion plus proof,
   not assertion alone.
5. **Association membership with numbers and dates**, including the association's SAPS
   accreditation number.
6. **Safe storage described concretely** — safe type, mounting, location, who has access.
7. **PAJA request** (see below).
8. For s13 self-defence: **personal circumstances**, residence security measures already
   taken, and the specific local threat picture — not national crime statistics alone.

---

## PAJA — two separate uses

1. **A section inside the motivation**, invoking s33 of the Constitution and PAJA s3(2).
2. **A standalone one-page letter**, filed *with* the application, requesting prior notice
   of an intention to refuse plus reasons, and an opportunity to make representations
   before the decision is taken.

The standalone letter is pre-emptive, not reactive. It is a small, high-value artefact we
can generate alongside the motivation — and it is the natural bridge into Phase 2's
escalation letters.

---

## What this changes in the build

| Was | Now |
|---|---|
| 2–4 page prose document | 15–30 page compiled submission |
| Flat section list | Cover page + TOC + running header + numbered annexure index |
| Uploads prefill fields | Uploads prefill fields **and become annexures**, cross-referenced inline |
| No calibre/comparison sections | `THE CALIBRE`, `EXISTING FIREARMS`, `COMPARISON` are first-class |
| Association = one field | Association, membership number, accreditation number, dedicated-status date, **and the exercises shot** |
| No PAJA | PAJA section **plus** a standalone PAJA letter as a second deliverable |

### Field-registry additions required

`existing_firearms_detail` (what they own, calibres, purposes) · `comparison_reasoning`
(why the new firearm is not a duplicate) · `calibre_justification` · `association_accreditation_no`
· `exercises_shot` (named exercises/disciplines) · `competency_status` (issued/pending, dates)
· `safe_specification` (SABS category, mounting) · `employment_confirmation`
· `character_references` · `residence_security_measures` (s13) · `local_threat_picture` (s13).

### Honest caveat on length

Some of the length in school A is padding — potted histories of sport shooting, lists of
ranges in South Africa. We should NOT reproduce that. It inflates the page count without
strengthening the application, and mass-produced padding is exactly the sameness signal the
variation engine exists to avoid. Aim for the argued sections done well, with real annexure
support, and let the page count be whatever that honestly comes to.
