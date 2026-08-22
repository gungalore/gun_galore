// ────────────────────────────────────────────────────────────────────
// THE DOCUMENT CENTRE — the member-facing home of everything they keep.
//
// Operator, 2026-08-22: "so we will have Document Centre and Motivation
// Centre." The module used to be the Licence Centre, and stopped being one the
// day it absorbed the application paperwork: an ID copy, proof of address and
// three photographs of a gun safe are not licences, and nobody hunting for
// their ID would think to open something called a licence tracker.
//
// ⚠️ THE ROUTE MOVED; NOTHING ELSE DID. The backend prefix, the module
// directory and the scan hand-off's `dest` string are all still
// `licence-centre` — a phone part-way through a hand-off is holding a token
// minted against that path, and renaming it would strand somebody standing at
// their desk right now. Only what a person clicks changed.
//
// ⚠️ /licence-centre STILL RENDERS THE SAME PAGE, deliberately, rather than
// redirecting. Reminder emails and push notifications sent before today carry
// that path, and a member who bookmarked it should not meet a 404 to satisfy a
// rename. Two doors, one room; only the sign changed. The implementation stays
// in its own directory so nothing in the module has to move.
// ────────────────────────────────────────────────────────────────────
export { default } from '../licence-centre/page';
