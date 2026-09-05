// ────────────────────────────────────────────────────────────────────
// Naming what the member scanned.
//
// ⚠️ THE NAME THEY TYPED USED TO GO NOWHERE. The review screen's own comment
// read "THE NAME IS EDITABLE HERE AND NOWHERE ELSE", and it was — into a piece
// of state that only the Saved screen ever read back. Every file left the
// scanner as `scan-<epoch>.jpg`, so six licences arrived in the Document
// Centre as six near-identical names, and the rejection rows there quoted
// that filename back at the member as if it meant something to them.
// ────────────────────────────────────────────────────────────────────

/** Longest name we keep. Filesystems allow more; nothing on screen shows it. */
export const NAME_MAX = 80;

/** Path separators and the characters Windows refuses in a filename. */
const FORBIDDEN = '\\/:*?"<>|';

/**
 * A name that is safe as a filename on every platform the file may land on.
 *
 * Path separators, the characters Windows refuses, and control characters
 * become spaces; runs of whitespace collapse; leading and trailing dots are
 * dropped so the file is never hidden or extension-less. Returns '' when
 * nothing usable is left — the caller keeps the generated name in that case
 * rather than inventing one.
 */
export function safeName(raw: string): string {
  let cleaned = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    cleaned += code < 32 || FORBIDDEN.includes(ch) ? ' ' : ch;
  }
  return cleaned
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, NAME_MAX)
    .trim();
}

/** The extension of an existing filename, dot included. '.jpg' when absent. */
function extensionOf(filename: string): string {
  const m = /\.[A-Za-z0-9]{1,5}$/.exec(filename);
  return m ? m[0].toLowerCase() : '.jpg';
}

/**
 * Re-name a batch of files after the document the member said they are.
 *
 * One file takes the name as given. Several take it with a page number, so a
 * five-page motivation annexure sorts and reads as one document rather than
 * five unrelated ones. An empty or unusable name leaves every file exactly as
 * it came — never a fabricated one.
 */
export function nameFiles(files: File[], name: string): File[] {
  const base = safeName(name);
  if (!base) return files;
  return files.map((f, i) => {
    const ext = extensionOf(f.name);
    const named = files.length === 1 ? `${base}${ext}` : `${base} p${i + 1}${ext}`;
    return new File([f], named, { type: f.type, lastModified: f.lastModified });
  });
}
