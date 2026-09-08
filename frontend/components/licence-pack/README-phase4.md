# What is left in here, and why

⚠️ **THIS DIRECTORY IS NAMED FOR A SCREEN THAT NO LONGER EXISTS.** The pack
wizard at `/licence-services/[id]` was deleted on 2026-09-08 with the rest of
Phase 4. What survives here is the set `MOTIVATION-REBUILD-BRIEF.md` §4 marks
as reuse-not-rewrite, imported by the new `/licence-centre` surface.

**Reached by the new surface today:**

- `saps271-meter.tsx` — via `components/licence-centre/pack-summary.tsx`
- `yes-no-pills.tsx` — via `components/licence-centre/declaration-row.tsx`
- `bulk-capture.tsx` — via the sheet's document shelf

**Kept, and NOT yet reached — see HANDOFF.md:**

- `pack-finish.tsx`, `delete-application.tsx` — pack-page furniture. The pack
  route renders the motivation, the 271 summary and the take-to-SAPS list; the
  generation-polling and delete panels are a follow-on.
- `extraction-review.tsx`, `attached-documents.tsx`, `section-chooser.tsx`
- `empty-answer.ts`, `owned-firearm-summary.ts` — pure helpers with specs.

⚠️ **AN ORPHANED COMPONENT IS NOT EVIDENCE OF A LIVE FEATURE**, which is the
same warning CLAUDE.md gives about orphaned Prisma models. Check for an
importer before believing one of these is on screen.

⚠️ `read-result.tsx` WAS on §4's reuse list and was deleted anyway, because it
could not survive: it imported `motivation-field-input` and `step-answers`,
both of which §3 names explicitly as NOT reused, and it is step-shaped
(`stepKey`) on a surface that has no steps. Its job — telling somebody what a
document read filled in — is done by `sheet-toast.tsx` plus the rows changing
state in place, which is specced in `components/licence-centre/`.
