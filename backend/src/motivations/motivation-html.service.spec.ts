import { type MotivationPdfInput } from './motivation-pdf.service';
import { renderMotivationHtml } from './motivation-html.service';

const base: MotivationPdfInput = {
  referenceNumber: 'MO000123',
  applicantName: 'Gerhard Fourie',
  idNumber: '8501015800081',
  licenceTypeLabel: 'Section 13 — Self-defence',
  body: [
    'Introduction:',
    'I apply under section 13 for a licence to possess a firearm.',
    'Why I need a firearm:',
    'The risk to me is real and documented.',
  ].join('\n\n'),
  disclaimer: 'Prepared with assistance.',
  templateVersion: 'tpl-test',
  generatedAt: new Date('2026-08-24T08:00:00Z'),
  firearmLine: 'Glock 19, 9mm Parabellum',
};

/**
 * The HTML of one marked section, so a test can ask where something appears
 * rather than merely whether it appears somewhere in the whole document.
 */
function section(html: string, name: string): string {
  const start = html.indexOf(`data-section="${name}"`);
  if (start < 0) return '';
  const next = html.indexOf('data-section="', start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}

describe('renderMotivationHtml', () => {
  it('emits a self-contained document', () => {
    const html = renderMotivationHtml(base);
    expect(html.startsWith('<!doctype html')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('@page { size: A4;');
    expect(html).not.toMatch(/<link\b|@import|url\(/i);
  });

  it('names the applicant and carries the reference', () => {
    const html = renderMotivationHtml(base);
    expect(html).toContain('Gerhard Fourie');
    expect(html).toContain('MO000123');
  });

  it('escapes model text and never injects markup', () => {
    const html = renderMotivationHtml({
      ...base,
      applicantName: 'Ann <script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('lists the body headings in the contents', () => {
    const html = renderMotivationHtml(base);
    const contents = section(html, 'contents');
    expect(contents).toContain('Introduction');
    expect(contents).toContain('Why I need a firearm');
  });

  it('drops the Purpose column when no firearm has a status', () => {
    const html = renderMotivationHtml({
      ...base,
      ownedFirearms: [
        {
          make: 'Mauser',
          calibre: '.30-06 Springfield',
          serial: '96008993',
          expiry: '28 Oct 2034',
          type: 'Rifle, bolt',
          section: '16',
        },
      ],
    });
    const owned = section(html, 'owned');
    expect(owned).toContain('Make and model');
    expect(owned).not.toContain('Purpose');
  });

  it('keeps the Purpose column when a status is present', () => {
    const html = renderMotivationHtml({
      ...base,
      ownedFirearms: [
        {
          make: 'Mauser',
          calibre: '.30-06 Springfield',
          serial: '96008993',
          expiry: '28 Oct 2034',
          status: 'Dedicated hunting',
        },
      ],
    });
    expect(section(html, 'owned')).toContain('Purpose');
  });

  it('is deterministic', () => {
    expect(renderMotivationHtml(base)).toBe(renderMotivationHtml(base));
  });

  it('omits optional blocks rather than printing empty ones', () => {
    const html = renderMotivationHtml(base);
    expect(section(html, 'owned')).toBe('');
    expect(section(html, 'spec')).toBe('');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
  });
});
