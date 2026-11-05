/**
 * THE RULEBOOK IS APPENDED, NEVER WRITTEN.
 *
 * The professional section 16 motivations we analysed (2026-11-05) carry the
 * association's own exercise rules verbatim — 12 to 23 of their 21 to 38 pages —
 * and that is the "detail" a DFO expects to check the application against.
 *
 * ⚠️ A MODEL MUST NOT PARAPHRASE IT. The writer produces one lead-in sentence
 * under the heading; this function puts the published text underneath it,
 * unaltered, with its source. Two reasons: a paraphrase beside the real rules
 * invites a comparison the applicant loses, and the exact text is the evidence.
 *
 * ⚠️ AND NOTHING IS INJECTED WHERE THE SECTION IS NOT. A type with no
 * association section has no heading to attach to, so the body is returned
 * untouched rather than gaining a floating rulebook with no lead-in.
 */
export interface RulebookText {
  associationName: string;
  code: string | null;
  title: string;
  text: string;
}

/** A heading line: "11. The association's rules for this exercise". */
const HEADING = /^\d{1,2}\.\s+/;

export function appendRulebook(
  body: string,
  heading: string,
  rulebook: RulebookText,
): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading.trim());
  if (start < 0) return body;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (HEADING.test(lines[i].trim())) {
      end = i;
      break;
    }
  }

  const source = `Source: ${rulebook.associationName} exercise rules${
    rulebook.code ? `, ${rulebook.code}` : ''
  } — ${rulebook.title}.`;

  const inserted = [
    '',
    ...rulebook.text.split(/\r?\n/),
    '',
    source,
    '',
  ];
  return [...lines.slice(0, end), ...inserted, ...lines.slice(end)].join('\n');
}
