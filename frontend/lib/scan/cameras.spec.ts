import { describe, expect, it } from 'vitest';
import { FOV_SAMPLE, type FovSample, centreCrop } from './fov';
import {
  type CameraOption,
  bestCamera,
  isRearLabel,
  kindFromLabel,
  matchPref,
  rankCameras,
} from './cameras';

// The exact labels the operator's two phones reported, from Scanbot's camera
// picker on each. These are real strings, not invented ones.
const IPHONE = ['Front Camera', 'Back Dual Wide Camera', 'Back Ultra Wide Camera', 'Back Camera'];
const SAMSUNG = [
  'camera 1, facing front',
  'camera 3, facing front',
  'camera 2, facing back',
  'camera 0, facing back',
];

const opt = (label: string, minFocusM: number | null = null): CameraOption => ({
  deviceId: `id:${label}`,
  label,
  kind: kindFromLabel(label),
  minFocusM,
});

describe('kindFromLabel', () => {
  it('⚠️ DOES NOT MISTAKE THE DEFAULT LENS FOR THE ULTRA WIDE', () => {
    // The iPhone's default is "Back Dual Wide Camera". A naive /wide/ match
    // selects exactly the lens we are trying to move away from, and looks
    // like it worked.
    expect(kindFromLabel('Back Dual Wide Camera')).toBe('wide');
    expect(kindFromLabel('Back Ultra Wide Camera')).toBe('ultra-wide');
  });

  it('handles the hyphenated and unspaced spellings too', () => {
    expect(kindFromLabel('Back Ultra-Wide Camera')).toBe('ultra-wide');
    expect(kindFromLabel('ultrawide back')).toBe('ultra-wide');
  });

  it('says unknown for Android, which names nothing', () => {
    for (const l of SAMSUNG) expect(kindFromLabel(l)).toBe('unknown');
  });
});

describe('isRearLabel', () => {
  it('keeps the rear cameras on both platforms and drops the front ones', () => {
    expect(IPHONE.filter(isRearLabel)).toEqual([
      'Back Dual Wide Camera',
      'Back Ultra Wide Camera',
      'Back Camera',
    ]);
    expect(SAMSUNG.filter(isRearLabel)).toEqual([
      'camera 2, facing back',
      'camera 0, facing back',
    ]);
  });

  it('⚠️ KEEPS AN UNLABELLED CAMERA RATHER THAN DROPPING IT', () => {
    // Labels are empty until a getUserMedia grant exists, and some webviews
    // never fill them. Dropping unlabelled devices would leave those phones
    // with no candidates at all.
    expect(isRearLabel('')).toBe(true);
  });
});

/** A deterministic textured scene, as any ordinary surface would give. */
function scene(seed = 7): FovSample {
  const size = FOV_SAMPLE;
  const data = new Uint8Array(size * size);
  const fx = 5 + (seed % 7);
  const fy = 4 + (seed % 5);
  let st = seed;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      st = (st * 1103515245 + 12345) & 0x7fffffff;
      const base = 128 + 80 * Math.sin(x / fx) * Math.cos(y / fy);
      data[y * size + x] = Math.max(0, Math.min(255, base + ((st >> 16) % 24) - 12));
    }
  }
  return { data, size };
}

describe('picking the lens — by measurement, not by name', () => {
  const WIDE = scene();

  it('⚠️ RANKS BY WHAT THE LENS SEES, NOT BY WHAT IT IS CALLED', () => {
    // The widest lens is the closest-focusing one, and field of view is
    // measurable with canvas grabs on both platforms. Labels are not: iOS
    // names its lenses, Android does not.
    const best = bestCamera([
      { ...opt('camera 0, facing back'), sample: centreCrop(WIDE, 0.4) },
      { ...opt('camera 2, facing back'), sample: WIDE },
    ]);
    expect(best?.label).toBe('camera 2, facing back');
  });

  it('⚠️ A LABEL SAYING "ULTRA WIDE" DOES NOT WIN AGAINST THE MEASUREMENT', () => {
    // This is the future-proofing. If a vendor renames a lens, or ships a
    // phone whose "Ultra Wide" is not the widest available, the name must not
    // override what we can see. Nothing errors when a string changes — which
    // is exactly why nothing may depend on one.
    const best = bestCamera([
      { ...opt('Back Ultra Wide Camera'), sample: centreCrop(WIDE, 0.4) },
      { ...opt('Back Camera'), sample: WIDE },
    ]);
    expect(best?.label).toBe('Back Camera');
  });

  it('puts unmeasured lenses behind measured ones', () => {
    // A lens the browser would enumerate but not open tells us nothing. It is
    // not a better guess than the one we actually looked through.
    const ranked = rankCameras([
      opt('camera 0, facing back'),
      { ...opt('camera 2, facing back'), sample: WIDE },
    ]);
    expect(ranked[0].label).toBe('camera 2, facing back');
  });

  it('⚠️ KEEPS ENUMERATION ORDER WHEN THE SCENE CANNOT SUPPORT A DECISION', () => {
    // Pointed at a blank wall there is genuinely nothing to measure. A
    // scanner that picks a different lens each time it opens is worse than
    // one that always picks the same mediocre lens.
    const flat: FovSample = {
      data: new Uint8Array(FOV_SAMPLE * FOV_SAMPLE).fill(90),
      size: FOV_SAMPLE,
    };
    const ranked = rankCameras([
      { ...opt('camera 2, facing back'), sample: flat },
      { ...opt('camera 0, facing back'), sample: flat },
    ]);
    expect(ranked.map((c) => c.label)).toEqual([
      'camera 2, facing back',
      'camera 0, facing back',
    ]);
  });

  it('⚠️ DECLINES TO CHOOSE WHEN THERE IS ONLY ONE REAR CAMERA', () => {
    // With one candidate there is no choice to make, and constraining by
    // deviceId is strictly narrower than facingMode for nothing gained.
    expect(bestCamera([opt('Back Camera'), opt('Front Camera')])).toBeNull();
    expect(bestCamera([])).toBeNull();
  });
});

describe('remembering the choice', () => {
  it('⚠️ MATCHES ON LABEL, BECAUSE deviceIds ROTATE', () => {
    // Chrome rotates deviceIds per origin and per permission grant, so a
    // stored id is routinely stale — and asking for a stale id with `exact`
    // throws OverconstrainedError rather than falling back.
    const live = IPHONE.map((l) => ({ ...opt(l), deviceId: 'rotated-since-last-visit' }));
    expect(matchPref(live, 'Back Ultra Wide Camera')?.label).toBe('Back Ultra Wide Camera');
  });

  it('returns null when the remembered lens is gone', () => {
    expect(matchPref(SAMSUNG.map((l) => opt(l)), 'Back Ultra Wide Camera')).toBeNull();
    expect(matchPref(IPHONE.map((l) => opt(l)), null)).toBeNull();
  });
});
