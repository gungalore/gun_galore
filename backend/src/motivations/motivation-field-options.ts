import { MotivationField } from './motivation-fields';
import {
  DISCIPLINE_OTHER,
  disciplineByValue,
  disciplinesInScope,
} from './shooting-disciplines';

// ────────────────────────────────────────────────────────────────────
// FIELDS THAT CARRY A LIST TOO BIG TO WRITE OUT BY HAND.
//
// The registry stays a registry: a `discipline` field says
// `optionSource: 'shooting-disciplines'` and nothing more. The fifty-nine
// options, their groupings and their prefill text are attached HERE, on the
// way out to the wizard, so the registry does not grow a data dump and the
// data does not grow a schema.
//
// ⚠️ THE VALUES ARE STORED ANSWERS. `value` is what lands in the applicant's
// answers blob and what the generated motivation is written from. Renaming one
// silently blanks the answer of anybody who had chosen it, so the values in
// shooting-disciplines.ts are append-only.
// ────────────────────────────────────────────────────────────────────

export interface FieldOption {
  value: string;
  label: string;
  /** Shown small, beside the option. The accrediting or governing body. */
  hint?: string;
}

export interface FieldOptionGroup {
  group: string;
  options: FieldOption[];
}

/** A served field: the registry entry plus anything expanded onto it. */
export interface ServedField extends MotivationField {
  optionGroups?: FieldOptionGroup[];
  /** value -> the text seeded into the `prefills` field when it is chosen. */
  prefillText?: Record<string, string>;
}

/**
 * "Something else", always last.
 *
 * A closed list of fifty-nine disciplines is still not every discipline shot in
 * South Africa — club-level and in-house events exist that no national body
 * publishes rules for. An applicant who shoots one of those must not be told
 * their sport does not exist.
 */
export const OTHER_OPTION: FieldOption = {
  value: DISCIPLINE_OTHER,
  label: 'Something else — I will describe it',
};

export function expandFields(fields: readonly MotivationField[]): ServedField[] {
  return fields.map((f) => {
    if (f.optionSource !== 'shooting-disciplines') return { ...f };

    // Scope comes from disciplinesInScope so the dropdown and the save-time
    // validation cannot drift apart — see allowedValues() in motivation-fields.
    const wanted = disciplinesInScope(f.optionScope);

    const groups: FieldOptionGroup[] = [];
    for (const d of wanted) {
      let g = groups.find((x) => x.group === d.group);
      if (!g) {
        g = { group: d.group, options: [] };
        groups.push(g);
      }
      g.options.push({ value: d.value, label: d.label, hint: d.body });
    }
    groups.push({ group: 'Not on the list', options: [OTHER_OPTION] });

    const prefillText: Record<string, string> = {};
    if (f.prefills) {
      for (const d of wanted) prefillText[d.value] = d.requirement;
    }

    return { ...f, optionGroups: groups, prefillText };
  });
}

/**
 * What to call a stored discipline value in prose.
 *
 * ⚠️ FALLS BACK TO THE RAW VALUE. Before this field was a dropdown it was a
 * text box, so a stored answer may be anything the applicant typed. Showing
 * their own words back is right; showing a blank because we no longer
 * recognise them is not.
 */
export function disciplineLabel(value: string, otherText?: string): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (v === DISCIPLINE_OTHER) return (otherText ?? '').trim() || 'Not listed';
  return disciplineByValue(v)?.label ?? v;
}
