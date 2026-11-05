import { HUNT_GAME_CLASS } from './motivation-cards';
import type { CardOption } from './motivation-fields';
import { classifyCalibre, type QuarryClass } from './motivation-overlap';

/**
 * Which "What you hunt" classes make sense for this calibre.
 *
 * The raw list is a national menu. A .223 applicant shown "dangerous game", or
 * a 12-gauge applicant shown "medium to large plains game", is being asked to
 * choose something the firearm cannot lawfully and sensibly do. The curated
 * cartridge table already knows the class; this narrows the menu to the classes
 * that belong to it and one sensible neighbour.
 *
 * An unknown calibre returns the whole menu: this is a filter, never a refusal,
 * and the applicant's own chambering is always the authority.
 */
const CLASS_KEYS: Record<QuarryClass, readonly string[]> = {
  rimfire: ['small'],
  varmint: ['small', 'plains_light'],
  medium_game: ['plains_light', 'plains_medium'],
  large_game: ['plains_medium'],
  dangerous_game: ['dangerous'],
  shotgun: ['wingshooting'],
  handgun: ['small', 'plains_light'],
};

export function huntGameClassOptions(
  calibre: string,
): readonly CardOption[] {
  const quarry = classifyCalibre(calibre);
  if (!quarry) return HUNT_GAME_CLASS;
  const allowed = new Set(CLASS_KEYS[quarry]);
  // A .375 is the conventional floor for dangerous game; a .300 or .338 is a
  // large-plains rifle and must not be offered "dangerous game" as if it were.
  if (quarry === 'large_game' && dangerousCapable(calibre)) {
    allowed.add('dangerous');
  }
  return HUNT_GAME_CLASS.filter((option) => allowed.has(option.key));
}

function dangerousCapable(calibre: string): boolean {
  return /\b(?:375|376|378|404|416|458|470|500|505|577|600)\b|9[.,]3\s?x\s?62/i.test(
    calibre,
  );
}
