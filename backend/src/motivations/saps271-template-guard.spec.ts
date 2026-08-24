import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Saps271Service } from './saps271.service';

// ────────────────────────────────────────────────────────────────────
// THE FORM IS PART OF THE MAP.
//
// Every value on the SAPS 271 is placed by ABSOLUTE COORDINATE, because the
// distributed form is a 12-page AcroForm whose 1,072 field names are
// randomised ("ZImnfo8UO"), carry no meaning, and differ between copies.
// Mapping by name is impossible, so the map is positional — and positional
// means it is only valid for the exact PDF it was measured against.
//
// ⚠️ THE FAILURE THIS PREVENTS IS SILENT. Swap in a newer SAPS revision and
// every coordinate still resolves, still draws, and lands somewhere wrong.
// Nothing throws. The applicant gets a form that LOOKS filled in, signs it,
// and hands a DFO their ID number in the box beside the one it belongs in.
//
// The operator is building a new fillable 271 (2026-08-24), so this is not a
// hypothetical: the guard is what turns that swap from a silent
// mis-fill into a loud refusal.
// ────────────────────────────────────────────────────────────────────

/** Where the service looks, in its own order. */
function templatePath(): string {
  const candidates = [
    path.join(process.cwd(), 'assets', 'saps271-blank.pdf'),
    path.join(process.cwd(), 'backend', 'assets', 'saps271-blank.pdf'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('saps271-blank.pdf not found for the test');
}

const REAL = templatePath();

const build = (svc: Saps271Service) =>
  svc.build({
    licenceType: 'S13_SELF_DEFENCE',
    answers: { full_name: 'Gerhard Fourie', id_number: '8905125220089' },
    motivationReference: 'MO000123',
  } as never);

describe('the 271 template guard', () => {
  it('fills normally against the form the map was measured on', async () => {
    const out = await build(new Saps271Service());
    expect(out.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('⚠️ REFUSES a different PDF rather than printing into the wrong boxes', async () => {
    // A real, valid, loadable PDF — just not THE one. This is exactly the
    // shape of a legitimate SAPS revision: everything works, nothing throws,
    // and every coordinate is now wrong.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saps-guard-'));
    const cwd = process.cwd();
    fs.mkdirSync(path.join(dir, 'assets'));
    // Borrow another shipped form: same publisher, same shape, wrong document.
    const other = path.join(cwd, 'assets', 'saps534-blank.pdf');
    fs.copyFileSync(other, path.join(dir, 'assets', 'saps271-blank.pdf'));

    process.chdir(dir);
    try {
      await expect(build(new Saps271Service())).rejects.toThrow(
        /does not match|cannot fill/i,
      );
    } finally {
      process.chdir(cwd);
    }
  });

  it('⚠️ says so in terms the APPLICANT can act on, not a stack trace', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saps-guard-'));
    const cwd = process.cwd();
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.copyFileSync(
      path.join(cwd, 'assets', 'saps534-blank.pdf'),
      path.join(dir, 'assets', 'saps271-blank.pdf'),
    );

    process.chdir(dir);
    try {
      const err = await build(new Saps271Service()).catch((e: Error) => e);
      const msg = (err as Error).message;
      // It must tell them their MOTIVATION is fine — the 271 is opt-in and
      // separate, and a member who reads "we cannot fill your form" should not
      // conclude their whole pack is broken.
      expect(msg).toMatch(/motivation is unaffected|still download/i);
      // And it must not leak a path or a hash at them.
      expect(msg).not.toMatch(/sha256|[0-9a-f]{16}|\.pdf|\//);
    } finally {
      process.chdir(cwd);
    }
  });

  it('the pinned hash is the hash of the shipped form', () => {
    // If this fails, either the asset changed without the map being re-measured
    // or the constant was bumped without the asset landing. Both are the same
    // mistake in opposite directions.
    const sha = createHash('sha256')
      .update(fs.readFileSync(REAL))
      .digest('hex');
    const src = fs.readFileSync(
      path.join(__dirname, 'saps271.service.ts'),
      'utf8',
    );
    expect(src).toContain(sha);
  });

  it('⚠️ the guard runs BEFORE anything is drawn', () => {
    // Verifying after the fill would produce a wrong form and then discard it,
    // which is safe but wasteful — and one refactor away from returning it.
    const src = fs.readFileSync(
      path.join(__dirname, 'saps271.service.ts'),
      'utf8',
    );
    const check = src.indexOf('TEMPLATE_SHA256');
    const firstDraw = src.indexOf('drawText');
    expect(check).toBeGreaterThan(-1);
    expect(firstDraw).toBeGreaterThan(-1);
    expect(check).toBeLessThan(firstDraw);
  });
});
