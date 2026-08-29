jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotificationsService } from './notifications.service';

// What the applicant is TOLD when their motivation finishes generating.
//
// Two things are being defended here and neither is obvious from the method.
//
// FIRST, the lock screen. The rule that a firearm notification never names the
// firearm is usually written down against the SMS, because that is the message
// with a visible preview — but persist() fans out to a web push built from the
// inbox row's OWN title and body, so an in-app row reading "your section 16
// 9mm motivation is ready" reaches the same lock screen by a different road.
// The MO reference is the only identifier any channel is allowed to carry.
//
// SECOND, the held-back branch. A document the gate sends back is FINISHED as
// far as the applicant is concerned — they are sitting on "Writing it — about
// a minute…" either way. It has to notify, and it has to say something
// different and honest rather than borrowing the "ready" copy.

function makeService() {
  const sent: {
    sms: string[];
    smsTo: (string | null)[];
    subjects: string[];
    emails: string[];
    inbox: Record<string, unknown>[];
  } = { sms: [], smsTo: [], subjects: [], emails: [], inbox: [] };
  const svc = Object.create(
    NotificationsService.prototype,
  ) as NotificationsService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    appUrl: 'https://alloutdoor.co.za',
    persist: jest.fn(async (n: Record<string, unknown>) => {
      sent.inbox.push(n);
    }),
    send: jest.fn(async (_to: string, subject: string, html: string) => {
      sent.subjects.push(subject);
      sent.emails.push(html);
    }),
    sendSms: jest.fn(async (to: string | null, body: string) => {
      sent.smsTo.push(to);
      sent.sms.push(body);
    }),
    // Flattened so an assertion can reach every slot, not just the body.
    email: (a: unknown) => JSON.stringify(a),
  });
  return { svc, sent };
}

// A real cuid is 25 characters — the longest the URL in an SMS ever gets.
const BASE = {
  userId: 'user-1',
  email: 'applicant@example.co.za',
  phone: '0820000000',
  name: 'Gerhard',
  motivationId: 'clw9x2k7t0000qwer1234abcd',
  referenceNumber: 'MO000123',
};

// Everything the applicant answered that must never leave the document.
const LEAKS =
  /firearm|calibre|caliber|9\s?mm|glock|pistol|handgun|rifle|shotgun|ammunition|section\s?1[3-6]|dedicated (sport|hunt)/i;

describe('motivationFinished copy', () => {
  describe('when the gate passed it', () => {
    it('reaches all three channels', async () => {
      const { svc, sent } = makeService();
      await svc.motivationFinished({ ...BASE, outcome: 'ready' });
      expect(sent.inbox).toHaveLength(1);
      expect(sent.sms).toHaveLength(1);
      expect(sent.emails).toHaveLength(1);
    });

    it('says the document is ready and links to it', async () => {
      const { svc, sent } = makeService();
      await svc.motivationFinished({ ...BASE, outcome: 'ready' });
      expect(sent.sms[0]).toMatch(/is ready/);
      // ⚠️ THE REBUILT WIZARD, NOT THE OLD PAGE. This link outlives the
      // cutover — every SMS already delivered carries whatever path was
      // hardcoded when it was sent, and none of them can be recalled. It
      // needs no build flag: /licence-services/[id] redirects to
      // /motivations/[id] whenever the flag is off, so it resolves in both
      // directions.
      expect(sent.sms[0]).toContain(
        `https://alloutdoor.co.za/licence-services/${BASE.motivationId}`,
      );
      expect(sent.inbox[0].url).toBe(`/licence-services/${BASE.motivationId}`);
    });

    it('promises NOTHING about the outcome at SAPS', async () => {
      // "Ready" means written and ready to read. We are not attorneys and the
      // Registrar is not ours to speak for.
      const { svc, sent } = makeService();
      await svc.motivationFinished({ ...BASE, outcome: 'ready' });
      const all = [
        ...sent.sms,
        ...sent.subjects,
        ...sent.emails,
        JSON.stringify(sent.inbox),
      ].join(' ');
      expect(all).not.toMatch(/approv|guarantee|will be granted|succeed/i);
    });
  });

  describe('when the gate held it back', () => {
    it('still reaches all three channels — silence is the worse outcome', async () => {
      const { svc, sent } = makeService();
      await svc.motivationFinished({ ...BASE, outcome: 'held' });
      expect(sent.inbox).toHaveLength(1);
      expect(sent.sms).toHaveLength(1);
      expect(sent.emails).toHaveLength(1);
    });

    it('does not tell them a held-back document is ready', async () => {
      const { svc, sent } = makeService();
      await svc.motivationFinished({ ...BASE, outcome: 'held' });
      expect(sent.inbox[0].title).toMatch(/more detail/i);
      expect(sent.subjects[0]).toMatch(/more detail/i);
      expect(sent.sms[0]).toMatch(/needs more detail/);
    });

    it('sends different copy from the ready case', async () => {
      const a = makeService();
      const b = makeService();
      await a.svc.motivationFinished({ ...BASE, outcome: 'ready' });
      await b.svc.motivationFinished({ ...BASE, outcome: 'held' });
      expect(a.sent.sms[0]).not.toBe(b.sent.sms[0]);
      expect(a.sent.subjects[0]).not.toBe(b.sent.subjects[0]);
      expect(a.sent.emails[0]).not.toBe(b.sent.emails[0]);
    });
  });

  describe('the lock screen', () => {
    it.each(['ready', 'held'] as const)(
      'names no firearm, calibre or licence section anywhere (%s)',
      async (outcome) => {
        const { svc, sent } = makeService();
        await svc.motivationFinished({ ...BASE, outcome });
        // The inbox row is in here on purpose: persist() builds the web push
        // out of its title and body, so it lands on a lock screen too.
        const previewable = [
          ...sent.sms,
          ...sent.subjects,
          String(sent.inbox[0].title),
          String(sent.inbox[0].body),
          // The preheader is what a phone shows under the subject line.
          JSON.parse(sent.emails[0]).preheader as string,
        ].join(' ');
        expect(previewable).not.toMatch(LEAKS);
        // It still has to be findable — by the one reference that leaks
        // nothing to whoever is standing next to them.
        expect(previewable).toContain('MO000123');
      },
    );

    it.each(['ready', 'held'] as const)(
      'keeps the SMS inside one GSM-7 segment (%s)',
      async (outcome) => {
        const { svc, sent } = makeService();
        await svc.motivationFinished({ ...BASE, outcome });
        // An em dash, an ellipsis or a curly apostrophe drops the whole
        // message into UCS-2 and halves the segment to 70 characters.
        expect(sent.sms[0]).toMatch(/^[\x20-\x7e]+$/);
        expect(sent.sms[0].length).toBeLessThanOrEqual(160);
      },
    );
  });

  describe('the inbox row', () => {
    it('is dismissible, because nothing ever resolves a motivation', async () => {
      // resolveByEntity has no motivation call site. A non-dismissible row
      // would sit in the inbox for good.
      const { svc, sent } = makeService();
      await svc.motivationFinished({ ...BASE, outcome: 'ready' });
      expect(sent.inbox[0].dismissible).toBe(true);
      // ...but it still deserves the buzz — this is the event they are waiting
      // on, and dismissible rows do not push without this.
      expect(sent.inbox[0].forcePush).toBe(true);
    });

    it('tags the push with the document, so a later outcome replaces it', async () => {
      const { svc, sent } = makeService();
      await svc.motivationFinished({ ...BASE, outcome: 'held' });
      expect(sent.inbox[0].linkedType).toBe('motivation');
      expect(sent.inbox[0].linkedId).toBe(BASE.motivationId);
    });

    it('uses a distinct type per outcome', async () => {
      const a = makeService();
      const b = makeService();
      await a.svc.motivationFinished({ ...BASE, outcome: 'ready' });
      await b.svc.motivationFinished({ ...BASE, outcome: 'held' });
      expect(a.sent.inbox[0].type).toBe('motivation_ready');
      expect(b.sent.inbox[0].type).toBe('motivation_needs_more_info');
    });
  });

  it('leaves a missing phone number to sendSms, and still emails', async () => {
    // sendSms owns the null-check and the SMS-mute preference — the same
    // single chokepoint every other method routes through. Branching here
    // instead would quietly fork that rule.
    const { svc, sent } = makeService();
    await svc.motivationFinished({ ...BASE, phone: null, outcome: 'ready' });
    expect(sent.smsTo).toEqual([null]);
    expect(sent.emails).toHaveLength(1);
    expect(sent.inbox).toHaveLength(1);
  });
});
