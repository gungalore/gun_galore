import { describe, expect, it, vi } from 'vitest';
import { probeCameras } from './cameras';

/**
 * ⚠️ A HANG IS NOT AN ERROR, AND try/catch CANNOT SEE IT.
 *
 * Opening a second camera while the first is still held is refused on many
 * Androids, and on some of them it is refused by NEVER ANSWERING rather than
 * by throwing. An awaited getUserMedia with nothing racing it then wedges
 * start-up: the scanner sits on "starting the camera" with no error anywhere,
 * because nothing failed.
 *
 * The probe used to run only when no lens was remembered, so a handset that
 * had once stored one never probed again and the fault stayed hidden. Making
 * the probe run every start-up turned it from once-per-phone into every time,
 * and the operator's Samsung stopped starting. The iPhone was never affected,
 * which is exactly how a concurrency limit presents.
 */
function fakeDevices(labels: string[]) {
  return labels.map((label, i) => ({
    kind: 'videoinput',
    label,
    deviceId: `dev${i}`,
    groupId: '',
    toJSON: () => ({}),
  })) as unknown as MediaDeviceInfo[];
}

describe('the lens probe can never wedge start-up', () => {
  it('gives up on a camera that never opens, and still returns', async () => {
    const devices = fakeDevices(['Back Camera', 'Back Ultra Wide Camera']);
    // getUserMedia that never settles — the Android failure, exactly.
    const gum = vi.fn(() => new Promise<MediaStream>(() => {}));
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: async () => devices,
        getUserMedia: gum,
      },
    });

    const started = Date.now();
    const cams = await probeCameras(null, { sample: true });
    const took = Date.now() - started;

    // It came back at all, which is the whole point.
    expect(cams).toHaveLength(2);
    // Nothing could be measured, so nothing claims to have been.
    expect(cams.every((c) => !c.sample)).toBe(true);
    // And it did not sit there forever. Two lenses at a 1.5s timeout, inside
    // a 3.2s budget, so well under ten seconds even on a slow runner.
    expect(took).toBeLessThan(10_000);
    vi.unstubAllGlobals();
  }, 20_000);

  it('returns immediately when there is nothing to choose between', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: async () => fakeDevices(['Back Camera']),
        getUserMedia: vi.fn(() => new Promise<MediaStream>(() => {})),
      },
    });
    const cams = await probeCameras(null, { sample: true });
    // One rear lens is no choice, so it must not open anything at all.
    expect(cams).toHaveLength(1);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
