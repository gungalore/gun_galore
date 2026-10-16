// ────────────────────────────────────────────────────────────────────
// THE MOTIVATION'S DOCUMENT FOLDERS — MOVED TO THE DICTIONARY.
//
// ⚠️ THE DATA LIVES IN document-dictionary.ts NOW, and it must keep mirroring
// `CLASSIFIABLE` in motivation-extract.service.ts; document-dictionary.spec.ts
// pins that. This module is a thin re-export so existing importers keep working.
// ────────────────────────────────────────────────────────────────────

export { MOTIVATION_KIND_OPTIONS } from './document-dictionary';
