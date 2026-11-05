/**
 * What the member asked us to produce.
 *
 * FULL_PACK       the motivation, the completed SAPS 271 and every annexure.
 * MOTIVATION_ONLY the legal motivation on its own, ready to attach to a form
 *                 the applicant or their dealer completes.
 *
 * The mode changes the questions, the document gate and the rendered pack. It
 * never changes the legal standard the motivation itself is written to.
 */
export const OUTPUT_MODES = ['FULL_PACK', 'MOTIVATION_ONLY'] as const;

export type MotivationOutputMode = (typeof OUTPUT_MODES)[number];

export const DEFAULT_OUTPUT_MODE: MotivationOutputMode = 'FULL_PACK';

export function normaliseOutputMode(value: unknown): MotivationOutputMode {
  return value === 'MOTIVATION_ONLY' ? 'MOTIVATION_ONLY' : DEFAULT_OUTPUT_MODE;
}

export function isMotivationOnly(value: unknown): boolean {
  return normaliseOutputMode(value) === 'MOTIVATION_ONLY';
}
