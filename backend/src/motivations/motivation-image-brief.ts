// ────────────────────────────────────────────────────────────────────
// THE SHAPE OF AN IMAGE PROMPT.
//
// xAI's Imagine prompting guide (read 2026-10-27) asks for the same order in
// every prompt of a series: the subject first — what it is, its form, what
// holds it, and the setting — then the details and the point the eye enters,
// then art direction, light, colour, lens and framing, and only then the
// exclusions. A prompt that opens with a film stock or a list of things to
// avoid draws a styled scene whose subject is a stand-in.
//
// ⚠️ THE SUBJECT COMES FIRST AND THE AVOID LIST LAST. Every species and scene
// prompt goes through `imageBrief`, and the course tail in motivation-courses.ts
// follows the same order, so it cannot drift prompt by prompt.
//
// ⚠️ AUTHENTIC, NOT DEGRADED. The operator's 2026-10-25 brief asked for
// unedited phone snapshots rather than supplied stock photographs. This
// treatment keeps the imperfect framing, ordinary light and clutter that make
// a snapshot read as the applicant's own record, but it does not ask for
// motion blur, soft focus, crushed shadows or a dirty lens: the guide's first
// requirement is that the subject in the picture matches the subject in the
// prompt, and a picture nobody can read fails that before it starts.
// ────────────────────────────────────────────────────────────────────

export interface ImageBrief {
  /** One sentence: what it is, its form, what holds it, and the setting. */
  subject: string;
  /** Elements, materials, count, the focal point and where the eye enters. */
  detail: string;
  /** The two or three named props and the colour fields. */
  art: string;
  /** Source, direction and hardness of light, and a readable exposure. */
  light: string;
  /** The subject's palette against the setting. */
  colour: string;
  /** Lens, camera height and framing. */
  lens: string;
  /** The authentic snapshot treatment. Shared by every exhibit. */
  treatment?: string;
  /** The exclusions. Always last. */
  avoid: string;
}

/** Trim a clause and close it with one full stop. */
function sentence(part: string): string {
  return `${part.trim().replace(/[.\s]+$/, '')}.`;
}

/**
 * Assemble a prompt in the guide's order.
 *
 * ⚠️ NOTHING HERE IS OPTIONAL EXCEPT THE TREATMENT. A missing light or lens
 * section is how the old prompts ended up as a subject followed by a wall of
 * prohibitions; the type makes that a build error rather than a silent
 * regression.
 */
export function imageBrief(brief: ImageBrief): string {
  return [
    brief.subject,
    brief.detail,
    brief.art,
    brief.light,
    brief.colour,
    brief.lens,
    brief.treatment,
    brief.avoid,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .map(sentence)
    .join(' ');
}

/**
 * The shared snapshot treatment.
 *
 * ⚠️ IT KEEPS THE OPERATOR'S AUTHENTICITY AND DROPS THE DEGRADATION. "Taken
 * quickly", "a degree or two off level", "clutter at the edges" and "ordinary
 * light" are what make the page read as the applicant's own record. "Motion
 * blur", "soft focus", "crushed shadows" and "a smudge on the lens" were in
 * the old tail too, and they only made the subject harder to identify.
 */
export const SNAPSHOT_TREATMENT =
  'Taken quickly on a phone by somebody who did not compose the shot, ' +
  'unedited and straight out of camera: the horizon is a degree or two off ' +
  'level, the subject sits a little off-centre inside the middle two-thirds ' +
  'of the frame, everyday clutter stays at the edges, the light is ordinary ' +
  'rather than professional, and the picture has mild grain and normal ' +
  'phone-camera sharpening';

/** No studio finish: the shared exclusions every exhibit carries. */
const NO_STUDIO =
  'No professional studio lighting, no colour grading and no HDR';

/** No marks of ours on a document somebody signs and lodges. */
const NO_MARKS = 'no text, no watermark, no logo, no overlay and no borders';

/**
 * A self-defence scene: the PLACE only.
 *
 * ⚠️ NO PEOPLE, WEAPONS OR ACTS. The picture model reads "self-defence" as
 * violence; these prompts picture the gate, road or corridor and never a
 * person, a firearm or a struggle. See motivation-plates.ts.
 */
export const SCENE_AVOID =
  'No people, no firearms, no weapons, no blood, no injury and no vehicles ' +
  `in motion. ${NO_STUDIO}; ${NO_MARKS}`;

/** A species exhibit: one real animal, with nothing drawn on it. */
export const SPECIES_AVOID =
  'No people, no vehicles in motion, no firearms, no weapons, no blood, no ' +
  `injury and no markings on the animal. ${NO_STUDIO}; ${NO_MARKS}`;

/** An empty course of fire: the place, never a shooter or an action. */
export const COURSE_AVOID =
  'No people, no shooter, no hands, no firearms, no weapons, no muzzle, no ' +
  'muzzle flash, no motion or action and no vehicles in motion. ' +
  `${NO_STUDIO}; ${NO_MARKS}`;
