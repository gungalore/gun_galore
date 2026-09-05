import {
  AIM_PASS_MARGIN,
  DCN_MEAN,
  DCN_SIZE,
  DCN_STD,
  decodeOutputs,
  mapFromRegion,
  regionForAim,
  toInputTensor,
} from './doccorner';

describe('doccorner (backend mirror)', () => {
  it('normalises RGB with ImageNet mean/std into NHWC', () => {
    const n = DCN_SIZE * DCN_SIZE;
    const rgb = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = 255;
      rgb[i * 3 + 2] = 128;
    }
    const t = toInputTensor(rgb, 3);
    expect(t.length).toBe(n * 3);
    expect(t[0]).toBeCloseTo((1 - DCN_MEAN[0]) / DCN_STD[0], 5);
    expect(t[1]).toBeCloseTo((0 - DCN_MEAN[1]) / DCN_STD[1], 5);
    expect(t[2]).toBeCloseTo((128 / 255 - DCN_MEAN[2]) / DCN_STD[2], 5);
  });

  it('decodes TL TR BR BL fractions and a sigmoid presence, clamped', () => {
    const r = decodeOutputs([-0.01, 0.2, 1.02, 0.2, 0.9, 0.8, 0.1, 0.8], 4);
    expect(r.quad[0]).toEqual({ x: 0, y: 0.2 });
    expect(r.quad[1].x).toBe(1);
    expect(r.score).toBeCloseTo(0.982, 3);
  });

  it('grows the aim box by the margin, clamps, and maps back', () => {
    const r = regionForAim({ x: 0.3, y: 0.4, width: 0.4, height: 0.2 });
    expect(r.x).toBeCloseTo(0.3 - 0.4 * AIM_PASS_MARGIN, 6);
    const edge = regionForAim({ x: 0.9, y: 0.9, width: 0.2, height: 0.2 });
    expect(edge.x + edge.w).toBeLessThanOrEqual(1);
    const q = mapFromRegion(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      { x: 0.25, y: 0.5, w: 0.5, h: 0.25 },
    );
    expect(q[2]).toEqual({ x: 0.75, y: 0.75 });
  });
});
