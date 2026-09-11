'use client';

/**
 * HEALTH — outbound channels, vendor credits and the credit floor editor.
 *
 * Three cards that answer one question: can this platform still reach anybody,
 * and will it still be able to tomorrow.
 *
 * ⚠️ CREDITS OWNS ITS OWN FETCHES NOW, ONE CATCH EACH. On the Site board they
 * were two fire-and-forget reads on the page loader that sat AFTER an `await`,
 * so a settings 500 meant the balances and the floors were never requested at
 * all — and the card was rendered only `credits.length ? … : null`, which made
 * "the read failed" and "this platform has no metered vendors" the same blank
 * space. Both are fixed here: the card always renders, and it says which of
 * the two it is.
 *
 * ⚠️ THE SETTINGS PANEL IS GONE FROM THIS SURFACE AND THE FLOOR EDITOR IS NOT.
 * A credit floor is an operational threshold that moves with supplier pricing;
 * the four ops flags move with a deploy. What that costs is written down in
 * lib/desk-cutover.ts under /admin/settings, because it is a real capability
 * removal and not a refactor.
 */
import * as React from 'react';
import {
  Button,
  DialogFrame,
  IconBell,
  IconBubble,
  IconLock,
  IconMail,
  IconPhone,
  Input,
  Label,
  Tag,
  Toggle,
  Vital,
} from '../../../../components/desk';
import { describeFailure } from '../../../../lib/desk-auth';
import {
  creditIsLow,
  creditUnreadable,
  describeThresholdVerdict,
  fetchCreditThresholds,
  fetchCredits,
  saveCreditThreshold,
  thresholdVerdict,
  type CreditSnapshot,
  type CreditThreshold,
} from '../../../../lib/desk-site';
import { Card, Row } from './board-bits';
import type { ChannelRow } from './board';

const CHANNEL_ICON = { email: IconMail, sms: IconPhone, push: IconBell, whatsapp: IconBubble } as const;

export function OutboundChannels({ channels }: { channels: ChannelRow[] }) {
  return (
    <Card label="Outbound channels">
      {channels.map((c, i) => {
        const Icon = CHANNEL_ICON[c.key as keyof typeof CHANNEL_ICON] ?? IconMail;
        return (
          <Row key={c.key} last={i === channels.length - 1}>
            <Icon size={14} style={{ color: 'var(--dk-ink-3)' }} />
            <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{c.label}</span>
            {/* Anything that is not explicitly ok or warn falls to neutral.
                See ChannelRow.tone: 'neutral' arrives on this wire despite not
                being in the union the backend declares. */}
            <Tag
              kind={c.tone === 'ok' ? 'ok' : c.tone === 'warn' ? 'warn' : 'neutral'}
              icon={c.tone === 'ok' ? null : undefined}
            >
              {c.state}
            </Tag>
            <span style={{ flex: 1 }} />
            <span style={{ width: 128, textAlign: 'right', fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
              {c.detail}
            </span>
          </Row>
        );
      })}
    </Card>
  );
}

export function Credits() {
  const [credits, setCredits] = React.useState<CreditSnapshot[] | null>(null);
  const [thresholds, setThresholds] = React.useState<CreditThreshold[]>([]);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [editingFloor, setEditingFloor] = React.useState<string | null>(null);

  const loadThresholds = React.useCallback(() => {
    // ⚠️ A THRESHOLD FAILURE COSTS THE "low" TAG AND THE "never flags" TAG,
    // and nothing else — the balances still render. So it has its own catch
    // rather than joining the balances' failure.
    void fetchCreditThresholds()
      .then(setThresholds)
      .catch(() => setThresholds([]));
  }, []);

  const load = React.useCallback(async () => {
    try {
      setCredits(await fetchCredits());
      setFailure(null);
    } catch (err) {
      setCredits([]);
      setFailure(describeFailure(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
    loadThresholds();
  }, [load, loadThresholds]);

  return (
    <Card
      label="Credits"
      hint="vendor balances"
      footer="Low means at or under the vendor warn floor. Edit a floor to change when that fires — the editor says outright whether what you have typed can ever go off, because a floor that cannot is indistinguishable on this row from a vendor that is simply well stocked. No balance API is a post-paid or key-less vendor, not a fault; colouring those amber is how amber stops meaning anything."
    >
      {failure ? (
        <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)', whiteSpace: 'pre-wrap' }}>
          {`Couldn't read the balances.\n${failure}`}
        </span>
      ) : null}

      {credits === null ? (
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>Reading…</span>
      ) : credits.length === 0 && !failure ? (
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>
          No vendor reports a balance. That is a real answer on a platform whose vendors are all
          post-paid — it is not the read having failed, which prints its own line above.
        </span>
      ) : (
        credits.map((c, i) => {
          const threshold = thresholds.find((t) => t.service === c.service);
          const low = creditIsLow(c, threshold);
          const unreadable = creditUnreadable(c);
          const verdict = threshold ? thresholdVerdict(threshold) : null;
          return (
            <Row key={c.service} last={i === credits.length - 1}>
              <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{c.service}</span>
              {/* 🚨 A FLOOR THAT CANNOT FIRE IS MARKED ON THE ROW, not left to
                  look like good news. Without this the operator cannot tell
                  "well stocked" from "wired so it never warns", which is the
                  exact state VerifyNow was in at 28 credits. */}
              {verdict && !verdict.fires && !unreadable ? (
                <Tag kind="neutral" icon={null}>
                  {verdict.why === 'off' ? 'alarm off' : 'never flags'}
                </Tag>
              ) : null}
              <span style={{ flex: 1 }} />
              {unreadable ? (
                <Tag kind={unreadable === 'failed' ? 'warn' : 'neutral'} icon={null}>
                  {unreadable === 'failed' ? 'could not read' : 'no balance API'}
                </Tag>
              ) : (
                <>
                  <span className="dk-mono" style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>
                    {c.balance === null
                      ? '—'
                      : `${c.balance.toLocaleString('en-ZA')}${c.unit ? ` ${c.unit}` : ''}`}
                  </span>
                  {low ? <Tag kind="warn">low</Tag> : null}
                </>
              )}
              <Button variant="ghost" onClick={() => setEditingFloor(c.service)}>
                Floor
              </Button>
            </Row>
          );
        })
      )}

      {editingFloor ? (
        <FloorDialog
          service={editingFloor}
          unit={credits?.find((c) => c.service === editingFloor)?.unit ?? null}
          current={thresholds.find((t) => t.service === editingFloor)}
          onClose={() => setEditingFloor(null)}
          onSaved={() => {
            setEditingFloor(null);
            // Re-read rather than patching state from the response: saving a
            // floor can change whether OTHER rows are flagged (the command
            // centre counts services below alarm off the same list).
            loadThresholds();
          }}
        />
      ) : null}
    </Card>
  );
}

/**
 * Edit one vendor's low-balance floor.
 *
 * 🚨 THE POINT OF THIS DIALOG IS THE SENTENCE UNDER THE FIELDS, not the
 * fields. Two numbers and a switch are easy; what the legacy page never did
 * was tell the operator that the pair they just saved is inert. There are
 * three ways to write a floor that never fires — switch it off, leave one
 * side blank, or put warn at or below alarm — and all three render on the
 * credits row exactly like a vendor that is comfortably stocked. That is the
 * state VerifyNow was in when it reached 28 credits with the board calm.
 *
 * So the verdict is computed from the LIVE field values on every keystroke,
 * by the same pure function the row uses, and it is shown whether it is good
 * news or bad. It never blocks the save — a spend ceiling in these columns is
 * a real thing an operator may want (anthropic uses one) — it just refuses to
 * let it be saved silently.
 */
function FloorDialog({
  service,
  unit,
  current,
  onClose,
  onSaved,
}: {
  service: string;
  unit: string | null;
  current: CreditThreshold | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [warn, setWarn] = React.useState(
    current?.warnThreshold === null || current?.warnThreshold === undefined
      ? ''
      : String(current.warnThreshold),
  );
  const [alarm, setAlarm] = React.useState(
    current?.alarmThreshold === null || current?.alarmThreshold === undefined
      ? ''
      : String(current.alarmThreshold),
  );
  const [enabled, setEnabled] = React.useState(current?.enabled ?? true);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  /** '' means "no floor", which is a different thing from 0. */
  const parse = (raw: string): number | null => {
    const t = raw.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const pending = {
    warnThreshold: parse(warn),
    alarmThreshold: parse(alarm),
    enabled,
  };
  const verdict = thresholdVerdict(pending);
  const isDefault = current?.source === 'default';

  async function save() {
    setSaving(true);
    setFailure(null);
    try {
      await saveCreditThreshold(service, pending);
      onSaved();
    } catch (err) {
      setFailure(describeFailure(err));
      setSaving(false);
    }
  }

  return (
    <DialogFrame
      label="Credit floor"
      title={service}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save floor'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {isDefault ? (
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--dk-ink-3)' }}>
            This vendor is on the built-in floor — there is no saved row for it yet. Saving
            creates one, and it overrides the default from then on.
          </span>
        ) : null}

        {/* <label>, not <div>: `Label` renders a <span>, so both inputs had
            the SAME placeholder ("no floor") as their only accessible name.
            A screen reader announced two identical fields, and there was
            nothing to say which one was the alarm. */}
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <Label>Warn at or below</Label>
            <Input
              value={warn}
              onChange={(e) => setWarn(e.target.value)}
              inputMode="numeric"
              placeholder="no floor"
            />
          </label>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <Label>Alarm at or below</Label>
            <Input
              value={alarm}
              onChange={(e) => setAlarm(e.target.value)}
              inputMode="numeric"
              placeholder="no floor"
            />
          </label>
        </div>

        <Toggle checked={enabled} onChange={setEnabled} label="Watch this vendor" />

        {/* The sentence this dialog exists for. */}
        <div
          style={{
            padding: '9px 11px',
            borderRadius: 6,
            background: 'var(--dk-inset)',
            border: `1px solid ${verdict.fires ? 'var(--dk-line-2)' : 'var(--dk-warn)'}`,
            fontSize: 12,
            lineHeight: 1.5,
            color: verdict.fires ? 'var(--dk-ink-2)' : 'var(--dk-ink)',
          }}
        >
          {describeThresholdVerdict(verdict, unit)}
        </div>

        {failure ? (
          <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-bad)' }}>
            {`Not saved. ${failure}`}
          </span>
        ) : null}
      </div>
    </DialogFrame>
  );
}

/**
 * WhatsApp channel health.
 *
 * 🚨 EVERY VITAL HERE IS AN EM DASH AND WILL BE UNTIL A WABA EXISTS. There is
 * no provider, no phone number, no template registry and no send path — the
 * credentials are the operator's to obtain and this file invents none of them.
 * The artboard's own figures ("14 registered · 0 approved") are mock numbers;
 * printing them would be a quality score for a number that has never sent a
 * message. The card states its gate on its face instead.
 *
 * ⚠️ THE GATE IS NOW READ OFF THE CHANNEL ROW, NOT OFF /admin/settings. Same
 * fact, same service, one fewer fetch — see whatsappOn() in board.ts. And
 * whatsapp_enabled is no longer editable from a browser at all, which is the
 * cost of dropping the settings panel and is recorded in the cutover map.
 */
export function WhatsappHealth({ enabled, phone }: { enabled: boolean; phone: boolean }) {
  return (
    <Card
      label="WhatsApp channel health"
      headerTag={
        <Tag kind={enabled ? 'warn' : 'neutral'} icon={enabled ? undefined : IconLock}>
          {enabled ? 'switched on · no provider' : 'gated · whatsapp_enabled off'}
        </Tag>
      }
      footer="States its gate on its face. A quality drop deals a Warden card once the number is live. Nothing here can be measured until a WABA, a phone number and a token are configured on the server — and whatsapp_enabled itself now moves in code, not from this board."
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: phone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        <Vital label="Quality" value="—" tone="unknown" sub="no WABA yet" />
        <Vital label="Block rate" value="—" tone="unknown" sub="no sends" />
        <Vital label="Read rate" value="—" tone="unknown" sub="no sends" />
      </div>
      <Row>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>Templates</span>
        <span style={{ flex: 1 }} />
        <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
          — · no registry
        </span>
      </Row>
      <Row>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>Wave</span>
        <span style={{ flex: 1 }} />
        <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
          — · no provider
        </span>
      </Row>
      <Row last>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>Consecutive failures</span>
        <span style={{ flex: 1 }} />
        <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
          — · nothing has sent
        </span>
      </Row>
    </Card>
  );
}
