import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSharePreview, readHead } from './share-preview';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('parseSharePreview', () => {
  const card = parseSharePreview(fixture('article-og.html'));

  it('reads the publisher’s own share card', () => {
    expect(card.title).toBe('Two arrested after Norkem Park house robbery');
    expect(card.description).toBe(
      'Police recovered a firearm and a stolen television in Birchleigh on Saturday morning.',
    );
    expect(card.publishedTime?.toISOString()).toBe('2026-09-06T05:15:00.000Z');
  });

  // ⚠️ THE FIXTURE PUTS content BEFORE property ON og:description ON PURPOSE.
  // Both orders are everywhere in the wild and a one-way regex silently
  // returns nothing for a whole publisher.
  it('reads a meta tag whose attributes are the other way round', () => {
    expect(
      parseSharePreview('<meta content="Hello" property="og:title">').title,
    ).toBe('Hello');
  });

  it('makes a protocol-relative og:image absolute', () => {
    expect(card.image).toBe(
      'https://kemptonexpress.co.za/wp-content/uploads/2026/09/robbery-1200x800.jpg',
    );
  });

  // ⚠️ article:author is a profile URL as often as a name, and a URL printed
  // as a byline reads as a mistake on the clipping.
  it('takes the author’s name and never a profile URL', () => {
    expect(card.author).toBe('Thabo Nkosi');
    expect(
      parseSharePreview('<meta property="article:author" content="https://x/a">')
        .author,
    ).toBeNull();
  });

  it('falls back to <title> and answers null for everything absent', () => {
    const none = parseSharePreview(fixture('article-no-og.html'));
    expect(none.title).toBe('Weekend netball results – Kempton Express');
    expect(none.description).toBeNull();
    expect(none.image).toBeNull();
    expect(none.publishedTime).toBeNull();
    expect(none.author).toBeNull();
  });
});

describe('readHead', () => {
  it('stops at </head> and never sees the body', async () => {
    const html = fixture('article-og.html');
    const head = await readHead(new Response(html));
    expect(head).toContain('og:title');
    expect(head).not.toContain('MUST NEVER BE READ');
  });

  // ⚠️ SOME CMSs INLINE A STYLESHEET AND PUSH </head> PAST THE CAP. The og:
  // tags are near the top of every one of them, so a truncated head must
  // still produce a card rather than an exception or an empty answer.
  it('returns what it has when </head> is past the cap', async () => {
    const filler = `<!-- ${'x'.repeat(4000)} -->`;
    const html =
      `<html><head><meta property="og:title" content="Early tag">` +
      filler +
      `</head><body>BODY TEXT</body></html>`;
    const head = await readHead(new Response(html), 1024);
    expect(head).not.toContain('BODY TEXT');
    expect(parseSharePreview(head).title).toBe('Early tag');
  });

  it('is empty for a response with no body', async () => {
    expect(await readHead(new Response(null, { status: 204 }))).toBe('');
  });
});
