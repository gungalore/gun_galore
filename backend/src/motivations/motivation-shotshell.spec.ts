import {
  SHOT_SHELLS,
  shotShellFor,
  shotshellDrawing,
} from './motivation-shotshell';

describe('shotShellFor', () => {
  it('resolves the three gauges we hold a C.I.P. sheet for', () => {
    expect(shotShellFor('12 Gauge')?.name).toBe('12/70');
    expect(shotShellFor('20 Gauge')?.name).toBe('20/70');
    expect(shotShellFor('.410')?.name).toBe('410/70');
  });

  it('resolves the C.I.P. spelling too', () => {
    expect(shotShellFor('12/70')?.name).toBe('12/70');
    expect(shotShellFor('410/70')?.name).toBe('410/70');
  });

  // ⚠️ A CHAMBERING WE HOLD NO SHEET FOR MUST NOT BORROW 70 mm's FIGURES. A
  // 12/76 printed at 69.80 mm would be a false dimension under a signature.
  it('refuses a chambering whose length we do not hold', () => {
    expect(shotShellFor('12/76')).toBeNull();
    expect(shotShellFor('20/65')).toBeNull();
  });

  it('never mistakes a rifle for a gauge', () => {
    expect(shotShellFor('.30-06 Springfield')).toBeNull();
    expect(shotShellFor('.45-70 Government')).toBeNull();
    expect(shotShellFor('9mm Parabellum')).toBeNull();
    expect(shotShellFor(undefined)).toBeNull();
  });
});

describe('the shot-shell drawing', () => {
  const shell = SHOT_SHELLS[0];

  it('draws a brass head and a red plastic hull', () => {
    const { svg } = shotshellDrawing(shell, { hero: true });
    expect(svg).toContain('id="brassHead"');
    expect(svg).toContain('id="redHull"');
  });

  // A shell has no bullet and no shoulder; the rifle drawing's telling shape is
  // the ogive, and it must not appear here.
  it('carries no bullet nose', () => {
    const { svg } = shotshellDrawing(shell, { hero: true });
    expect(svg).not.toContain('ogive');
    expect(svg).not.toContain('jacket');
  });

  it('calls out the length the sheet prints, and nothing invented', () => {
    const { texts } = shotshellDrawing(shell, { hero: true });
    const labels = texts.map((t) => t.text);
    expect(labels).toContain('69.80 mm');
  });

  it('draws the diameter callouts on the body figure, not the cover', () => {
    const hero = shotshellDrawing(shell, { hero: true });
    const body = shotshellDrawing(shell, { hero: false });
    expect(hero.texts.filter((t) => t.text.startsWith('Ø'))).toHaveLength(0);
    expect(body.texts.filter((t) => t.text.startsWith('Ø')).length).toBeGreaterThan(0);
  });

  it('scales to the paper width whatever the gauge', () => {
    for (const s of SHOT_SHELLS) {
      const d = shotshellDrawing(s, { hero: true });
      expect(d.widthMm).toBe(166);
      expect(d.heightMm).toBeGreaterThan(0);
    }
  });
});
