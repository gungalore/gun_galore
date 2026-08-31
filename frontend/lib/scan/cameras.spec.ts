import { describe, expect, it } from 'vitest';
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

describe('picking the lens', () => {
  it('⚠️ PICKS THE ULTRA WIDE ON THE IPHONE, NOT THE DEFAULT', () => {
    // This is the operator's actual complaint, on his actual phone.
    const best = bestCamera(IPHONE.map((l) => opt(l)));
    expect(best?.label).toBe('Back Ultra Wide Camera');
  });

  it('⚠️ PREFERS A MEASURED FOCUS DISTANCE OVER ANY LABEL', () => {
    // Chrome-Android reports focusDistance and Safari does not. Where we have
    // the real number it settles the question — even against a label that
    // says "ultra wide", because the number is the property we actually want.
    const best = bestCamera([
      opt('Back Ultra Wide Camera', 0.2),
      opt('Back Camera', 0.05),
    ]);
    expect(best?.label).toBe('Back Camera');
  });

  it('falls back to enumeration order when the phone tells us nothing', () => {
    // Samsung: two rear cameras, no useful labels, no focusDistance. Stable
    // beats clever — a scanner that picks a different lens each session is
    // worse than one that always picks the same wrong lens.
    const best = bestCamera(SAMSUNG.map((l) => opt(l)));
    expect(best?.label).toBe('camera 2, facing back');
  });

  it('never picks a telephoto, whose near limit is the worst of the set', () => {
    const ranked = rankCameras([
      opt('Back Telephoto Camera'),
      opt('Back Camera'),
      opt('Back Ultra Wide Camera'),
    ]);
    expect(ranked[0].label).toBe('Back Ultra Wide Camera');
    expect(ranked[ranked.length - 1].label).toBe('Back Telephoto Camera');
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
