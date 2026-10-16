// ────────────────────────────────────────────────────────────────────
// THE VAULT'S FOLDER VOCABULARY — MOVED TO THE DICTIONARY.
//
// ⚠️ THE DATA LIVES IN document-dictionary.ts NOW. This module is a thin
// re-export kept so every existing importer (the extract service, the filing
// service, the specs) keeps working unchanged. The header that explained the
// discriminators moved with the arrays. See document-dictionary.ts.
// ────────────────────────────────────────────────────────────────────

export {
  VAULT_COVER_OPTIONS,
  VAULT_KIND_OPTIONS,
} from './document-dictionary';
