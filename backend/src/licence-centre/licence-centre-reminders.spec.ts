import { REMINDER_STAGES } from './licence-dates';
import { tighterUnfired } from './licence-centre-reminders.service';
import { FLAGS } from '../settings/settings.service';
import { moduleForNotification } from '../notifications/notification-module';

// LC1. The reminder sweep is the whole reason the Centre exists, and the two
// ways it can go wrong are both silent: it reminds nobody, or it reminds the
// same person every night about a document that expired last year.

describe('no tighter stage has already fired', () => {
  it('lets the widest stage run with nothing else claimed', () => {
    expect(tighterUnfired('T180')).toEqual({
      remind120SentAt: null,
      remind100SentAt: null,
      remind30SentAt: null,
      remindD0SentAt: null,
    });
  });

  it('adds no condition to the last stage — nothing is tighter than the day itself', () => {
    expect(tighterUnfired('D0')).toEqual({});
  });

  it('never guards a stage against ITSELF', () => {
    // The stage's own column is already in the caller's where-clause; putting
    // it here too would be harmless but the duplication hides the intent.
    for (const s of REMINDER_STAGES) {
      expect(Object.keys(tighterUnfired(s.stage))).not.toContain(s.column);
    }
  });

  it('guards every stage that comes after it, and only those', () => {
    // THE BUG THIS PREVENTS: `lte` windows stay true forever. A document that
    // has already had "it has expired" is still, technically, inside the
    // "expires within 180 days" window — so without this it collects a fresh
    // T-180 message every single night, for ever.
    const keys = Object.keys(tighterUnfired('T100'));
    expect(keys).toEqual(['remind30SentAt', 'remindD0SentAt']);
  });

  it('names real columns from the stage table', () => {
    const known = new Set(REMINDER_STAGES.map((s) => s.column));
    for (const s of REMINDER_STAGES) {
      for (const k of Object.keys(tighterUnfired(s.stage))) {
        expect(known.has(k as never)).toBe(true);
      }
    }
  });
});

describe('the flags this module ships behind', () => {
  it('are all OFF by default, so it deploys inert', () => {
    expect(FLAGS.licenceCentreEnabled.default).toBe(false);
    expect(FLAGS.licenceCentreRemindersEnabled.default).toBe(false);
    expect(FLAGS.licenceCentreSmsEnabled.default).toBe(false);
  });

  it('reads a boolean the OFF-by-default way', () => {
    // An ON-by-default flag in this codebase parses `s !== 'false'`. Copying
    // that here would make an unset key mean ON.
    expect(FLAGS.licenceCentreEnabled.parse('true')).toBe(true);
    expect(FLAGS.licenceCentreEnabled.parse('1')).toBe(true);
    expect(FLAGS.licenceCentreEnabled.parse('')).toBe(false);
    expect(FLAGS.licenceCentreEnabled.parse('anything')).toBe(false);
  });

  it('clamps the document cap rather than trusting the field', () => {
    const p = FLAGS.licenceCentreMaxCredentials.parse;
    expect(p('50')).toBe(50);
    expect(p('0')).toBe(60);
    expect(p('-3')).toBe(60);
    expect(p('banana')).toBe(60);
    // Each document is an encrypted file, and most are a vision call too.
    expect(p('99999')).toBe(500);
  });

  it('leaves room for the whole application folder, not only the licences', () => {
    // ⚠️ THE OLD CEILING OF 25 WAS SET AGAINST A NARROWER CENTRE. It now also
    // holds an ID copy, proof of address, confirmation of employment, three
    // safe photographs, the installation shot and an activity log — eight
    // before a single licence — so a section 16 member with eight licensed
    // firearms sits near 19 and would have been within a few documents of
    // "Remove one before adding another".
    expect(FLAGS.licenceCentreMaxCredentials.default).toBe(60);
    expect(FLAGS.licenceCentreMaxCredentials.parse('')).toBe(60);
  });
});

describe('where a reminder takes the member', () => {
  it('routes every Licence Centre notification to the Centre', () => {
    for (const t of [
      'licence_centre_expiry_180',
      'licence_centre_expiry_30',
      'licence_centre_expired',
      'licence_centre_confirm_needed',
    ]) {
      expect(moduleForNotification(t, 'ACCOUNT')).toBe('/licence-centre');
    }
  });

  it('does NOT steal the listing licence-expiry type', () => {
    // firearm_licence_expiring is about a LISTING's licence and belongs on
    // /my/listings. Our prefix must not swallow it.
    expect(moduleForNotification('firearm_licence_expiring', 'SELLER')).toBe(
      '/my/listings',
    );
  });
});
