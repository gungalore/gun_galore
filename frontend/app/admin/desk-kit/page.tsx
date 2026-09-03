'use client';

/**
 * THE DESK — the kit fixture.
 *
 * This page exists to be compared against the Kit artboard on the design
 * canvas, at 1440 and at 390. It is not a product surface and never ships to
 * an operator; Phase 1 is accepted when this page and that artboard agree.
 *
 * Every component is rendered in every state it has, including the ugly ones
 * — gated, failed, loading, sunk. A kit page that only shows the happy state
 * is how a surface reaches production having never rendered its own error.
 */
import * as React from 'react';
import {
  AllClear,
  Amount,
  BarList,
  Band,
  Button,
  ChartCard,
  ChatComposer,
  Checkbox,
  Chip,
  DeskCard,
  DeskTable,
  Drawer,
  FailedRegion,
  IconAlert,
  IconBolt,
  IconCheck,
  IconChevronRight,
  IconClock,
  Funnel,
  IconExternal,
  IconLock,
  IconSearch,
  IconShield,
  Input,
  Key,
  Kpi,
  LineChart,
  OperatorMessage,
  Kv,
  Label,
  MoneyDialog,
  RadioRow,
  RailCard,
  ReasonDialog,
  Ref,
  ResultBlock,
  Ribbon,
  SearchPalette,
  Rule,
  Section,
  SkeletonPile,
  Split,
  Tag,
  Timeline,
  Toggle,
  TopTabs,
  UndoToast,
  Vital,
  WardenMessage,
  formatRand,
} from '../../../components/desk';

/* Sample data. Invented — refs, usernames, amounts and phone digits are all
 * made up, exactly as the canvas notes say. Nothing here reaches an API. */
const ROWS = [
  { ref: 'UM000431', item: 'Garmin inReach Mini 2', amount: 315000, status: 'Disputed', attention: 'due in 14h' },
  { ref: 'UM000577', item: 'Cadac Safari Chef 2', amount: 189000, status: 'Held', attention: 'Dispatch SLA +19h' },
  { ref: 'UM000598', item: 'Howa 1500 .308', amount: 1890000, status: 'Verifying', attention: 'awaiting dealer' },
];

export default function DeskKitFixture() {
  const [chip, setChip] = React.useState('attention');
  const [drawer, setDrawer] = React.useState(false);
  const [money, setMoney] = React.useState(false);
  const [seconds, setSeconds] = React.useState(8);
  const [reason, setReason] = React.useState(false);
  const [palette, setPalette] = React.useState(false);
  const [query, setQuery] = React.useState('garmin');
  const [waToggle, setWaToggle] = React.useState(false);
  const [wake, setWake] = React.useState(true);
  const [pick, setPick] = React.useState('photos');
  const [chat, setChat] = React.useState('');

  // The undo ring, ticking so the fixture shows real motion rather than a
  // frozen arc that could be hiding a broken dasharray.
  React.useEffect(() => {
    const id = setInterval(() => setSeconds((s) => (s <= 0 ? 10 : s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ padding: '28px 32px 96px', display: 'flex', flexDirection: 'column', gap: 26 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em' }}>The kit</h1>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>
          every token, control and state the build needs · scoped under [data-desk] as --dk-* tokens
        </span>
      </header>

      <Grid>
        <Panel
          title="Colour"
          note="Cool green-black neutrals, one ink, four state colours. The only colour on screen is state — there is no brand accent."
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[
              ['--dk-ground', 'page ground'],
              ['--dk-surface', 'cards, tables, chat bubbles'],
              ['--dk-raised', 'drawers, rail, dialogs, hover'],
              ['--dk-inset', 'inputs, chips, thumbs, skeletons'],
              ['--dk-line', 'hairlines: card borders, rules, rows'],
              ['--dk-line-2', 'control borders, strong rules'],
              ['--dk-ink', 'text, primary buttons, the chart hue'],
              ['--dk-ink-2', 'secondary text, meta'],
              ['--dk-ink-3', 'labels, captions'],
              ['--dk-ink-4', 'faint: refs, axes, disabled'],
              ['--dk-ok', 'success · swipe reveal · toggle on'],
              ['--dk-warn', 'warning · SLA · gated'],
              ['--dk-bad', 'action required · overdue · red gate'],
              ['--dk-info', 'due times, held, proposals'],
            ].map(([token, use]) => (
              <div
                key={token}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '7px 0',
                  borderBottom: '1px solid var(--dk-line)',
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    flex: 'none',
                    borderRadius: 6,
                    border: '1px solid var(--dk-line-2)',
                    background: `var(${token})`,
                  }}
                />
                <span className="dk-mono" style={{ fontSize: 11.5, color: 'var(--dk-ink)' }}>
                  {token}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{use}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Buttons"
          note="Primary is ink on ground — the loudest thing on a dark page without spending a colour. A money button carries its amount. A gated button says so and declines."
        >
          <Row>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost" trailingIcon={IconExternal}>Ghost</Button>
          </Row>
          <Row>
            <Button variant="gated">Payouts are gated</Button>
            <Button variant="danger">Reject…</Button>
            <Button variant="ok" icon={IconCheck}>Approve · swipe reveal only</Button>
          </Row>
          <Row>
            <Button variant="primary" amount={formatRand(315000)}>Refund</Button>
            <Button variant="primary" amount={formatRand(1840000)} icon={IconCheck}>Approve · release</Button>
            <Button variant="primary" loading>Sending</Button>
            <Button variant="secondary" disabled>Disabled</Button>
          </Row>
          <Hint>
            <b>Ellipsis</b> means a dialog follows (a reason, a money confirm). <b>Danger</b> is quiet:
            red text and border, never a red fill. <b>Focus</b> is an outline, never a ring.
          </Hint>
        </Panel>

        <Panel
          title="Tags"
          note="Colour is never the only signal: warning and critical tags always carry an icon and words. Neutral tags are ink on inset."
        >
          <Row>
            <Tag kind="ok">Released</Tag>
            <Tag kind="ok" icon={IconCheck}>fixed alone</Tag>
            <Tag kind="warn">19h over SLA</Tag>
            <Tag kind="warn" icon={IconLock}>Payouts are gated</Tag>
            <Tag kind="bad">26h waiting</Tag>
            <Tag kind="bad" icon={IconLock}>red gate</Tag>
          </Row>
          <Row>
            <Tag kind="info" icon={IconClock}>due in 14h</Tag>
            <Tag kind="info">Held</Tag>
            <Tag kind="info" icon={IconBolt}>proposal</Tag>
            <Tag kind="neutral">oldest of 6</Tag>
            <Tag kind="neutral">later · back 12:40</Tag>
            <Tag kind="ink">SAPS dealer</Tag>
          </Row>
        </Panel>

        <Panel title="Controls" note="Inputs and chips sit on inset; the active chip is ink-filled like the active tab.">
          <Input placeholder="Search members and dealers" icon={IconSearch} />
          <Input placeholder="Add a note for the audit trail…" />
          <Input placeholder="Amount" error="Enter an amount in rand" defaultValue="R—" />
          <Row>
            <Chip active={chip === 'attention'} count={6} onClick={() => setChip('attention')}>
              Needs attention
            </Chip>
            <Chip active={chip === 'all'} count={186} onClick={() => setChip('all')}>
              All
            </Chip>
            <Chip active={chip === 'held'} count={23} onClick={() => setChip('held')}>
              Held
            </Chip>
          </Row>
          <Row>
            <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>Shortcut hints</span>
            <Key>Ctrl</Key>
            <Key>K</Key>
            <Key>J</Key>
            <Key>Enter</Key>
          </Row>
        </Panel>

        <Panel title="Tabs" note="Five surfaces, one set of names. Desktop is a pill row in the top bar; the phone is bottom tabs. A real tablist.">
          <TopTabs active="desk" />
        </Panel>

        <Panel
          title="Numbers"
          note="Ribbon cells, KPI tiles and rail values share one recipe: mono label, mono value, quiet sub-line. Deltas are ink with an arrow, not green or red."
        >
          <Ribbon
            cells={[
              { label: 'Sales today', value: formatRand(8421000), sub: '9 orders' },
              { label: 'Held', value: formatRand(14290000), sub: '23 orders' },
              { label: 'Site', value: 'Healthy', sub: '9 of 9 checks', dot: 'ok' },
            ]}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <Kpi label="Sales" value={formatRand(41230000)} delta="12%" deltaContext="vs prior 30 days" />
            <Kpi label="New members" value="241" delta="3%" />
            <Kpi label="Conversion" value="2.4%" delta="0.3 pt" deltaDirection="down" />
          </div>
        </Panel>

        <Panel title="The rail" note="Three raised cards beside the pile on desktop; the phone folds them into the body.">
          <RailCard label="Money right now">
            <Kv k="Held for buyers" v={formatRand(14290000)} />
            <Kv k="Ready to pay out" v={formatRand(3661000)} />
            <Kv k="Blocked" v={formatRand(598000)} tone="warn" />
            <Kv k="Refund pending" v={formatRand(315000)} last />
            <span style={{ fontSize: 11.5, color: 'var(--dk-warn)', marginTop: 2 }}>
              Payouts are gated — PAYMENTS_LIVE is off, so these balances are real but nothing disburses.
            </span>
          </RailCard>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            <Vital label="Disk" value="62%" fill={0.62} tone="ok" />
            <Vital label="Memory" value="71%" fill={0.71} tone="warn" />
            <Vital label="Backups" value="—" tone="unknown" sub="never measured" />
          </div>
        </Panel>
      </Grid>

      <Panel
        title="Card & band"
        note="The card is the unit of work. Type label, ref and tags on the first line; headline; meta; actions with Later at the far right."
        wide
      >
        <Band label="Reviews & cases" count={5}>
          <DeskCard
            type="listing_review"
            typeLabel="Listing review"
            reference="UM000598"
            headline="Default"
            meta="hairline border on surface"
            tags={[{ kind: 'neutral', label: 'oldest of 6' }]}
            actions={[
              { label: 'Approve', variant: 'primary', icon: IconCheck },
              { label: 'Reject…', variant: 'secondary' },
              { label: 'Open listing', variant: 'ghost', trailingIcon: IconExternal },
            ]}
          />
          <DeskCard
            type="listing_review"
            typeLabel="Listing review"
            reference="UM000598"
            headline="Selected · J/K or tap"
            meta="border --dk-ink-2 · A fires the primary action, Enter opens"
            selected
            tags={[{ kind: 'neutral', label: 'oldest of 6' }]}
            actions={[
              { label: 'Approve', variant: 'primary', icon: IconCheck },
              { label: 'Reject…', variant: 'secondary' },
            ]}
          />
          <DeskCard
            type="firearm_transfer"
            typeLabel="Firearm transfer"
            reference="AU000212"
            headline="Howa 1500 .308 — awaiting dealer verification"
            meta={
              <>
                @kudu_hunter → @rooikat · Bushveld Arms ·{' '}
                <span className="dk-mono">{formatRand(1840000)}</span> held
              </>
            }
            tags={[{ kind: 'bad', label: '26h waiting' }]}
            note="Money never undoes. Approving releases the buyer's funds to the seller."
            actions={[
              { label: 'Open & verify', variant: 'primary', trailingIcon: IconChevronRight },
            ]}
          />
          <DeskCard
            type="unanswered_question"
            typeLabel="Unanswered question"
            reference="UM000431"
            headline="Sunk by Later"
            meta="dimmed, tagged with its return time, and its Later button withdrawn"
            laterUntil="12:40"
          />
          <DeskCard
            type="warden"
            typeLabel="Warden · red gate"
            headline="Identity checks are running in sandbox"
            meta="A red gate cannot be sunk and cannot be acknowledged — it sits at the top of Housekeeping until it changes."
            tags={[{ kind: 'bad', label: 'red gate', icon: IconLock }]}
            canLater={false}
            actions={[{ label: 'Open the chat', variant: 'primary', trailingIcon: IconChevronRight }]}
          />
        </Band>
      </Panel>

      <Panel title="Table" note="Ledger rows: 50px, mono refs and money, right-aligned amounts, tags in the row. The whole row opens the drawer." wide>
        <DeskTable
          rows={ROWS}
          rowKey={(r) => r.ref}
          onOpen={() => setDrawer(true)}
          columns={[
            { key: 'ref', header: 'Ref', width: '110px', render: (r) => <Ref>{r.ref}</Ref> },
            { key: 'item', header: 'Item', width: 'minmax(0, 1fr)', render: (r) => r.item },
            {
              key: 'amount',
              header: 'Amount',
              width: '120px',
              align: 'right',
              render: (r) => <Amount>{formatRand(r.amount)}</Amount>,
            },
            {
              key: 'status',
              header: 'Status',
              width: '130px',
              render: (r) => (
                <Tag kind={r.status === 'Disputed' ? 'bad' : r.status === 'Verifying' ? 'warn' : 'info'} icon={null}>
                  {r.status}
                </Tag>
              ),
            },
            {
              key: 'attention',
              header: 'Needs attention',
              width: '190px',
              render: (r) => <Tag kind="warn">{r.attention}</Tag>,
            },
          ]}
        />
      </Panel>

      <Grid>
        <Panel title="Loading" note="Three skeleton cards under the ribbon on first paint. No spinner.">
          <SkeletonPile count={2} />
        </Panel>
        <Panel title="Failed" note="The region quotes the server and offers Retry; everything around it stays live.">
          <FailedRegion
            title="Couldn't load the pile"
            detail={'GET /admin/desk\n502 Bad Gateway\n\nupstream connect error or disconnect/reset before headers'}
            onRetry={() => undefined}
          />
        </Panel>
        <Panel title="Verbatim results" note="What the server said, not what we wish it had said." wide={false}>
          <ResultBlock ok tag="accepted" body={'{\n  "payoutRef": "PO-88213",\n  "status": "PROCESSING"\n}'} />
          <ResultBlock
            ok={false}
            tag="failed"
            body={'{\n  "error": "BANK_ACCOUNT_HOLDER_MISMATCH",\n  "message": "Account holder does not match the verified seller name"\n}'}
          />
        </Panel>
        <Panel title="All clear" note="The best outcome the Desk has, stated once.">
          <AllClear next="New work lands here the moment it appears — a listing to review, a dealer transfer, a dispute." />
        </Panel>
      </Grid>

      <Grid>
        <Panel title="Switches" note="The toggle is the only filled state colour the operator aims at — on and off is genuinely a state.">
          <Row>
            <Toggle checked={waToggle} onChange={setWaToggle} label="WhatsApp channel" />
            <span style={{ fontSize: 12.5, color: 'var(--dk-ink-2)' }}>WhatsApp channel — kill switch</span>
          </Row>
          <Checkbox checked={wake} onChange={setWake} label="BACKUP_FAILED wakes me" />
          <RadioRow
            name="fixture-reason"
            checked={pick === 'photos'}
            onChange={() => setPick('photos')}
            label="Photos are not the seller's own"
            sub="counts as a strike"
          />
          <RadioRow
            name="fixture-reason"
            checked={pick === 'other'}
            onChange={() => setPick('other')}
            label="Other"
          />
          <Row>
            <Button variant="secondary" onClick={() => setReason(true)}>Open a reason dialog</Button>
            <Button variant="secondary" onClick={() => setPalette(true)}>Open search</Button>
          </Row>
        </Panel>

        <Panel title="Charts" note="Hand-rolled SVG, one hue: ink at 100%, then opacity steps. Grid lines are --dk-line, axis text --dk-ink-4 mono 10.">
          <ChartCard label="Daily sales">
            <LineChart
              points={[
                { label: '1 Aug', value: 12 },
                { label: '8 Aug', value: 19 },
                { label: '15 Aug', value: 14 },
                { label: '22 Aug', value: 23 },
                { label: '29 Aug', value: 21 },
              ]}
              height={150}
            />
          </ChartCard>
          <ChartCard label="Top categories">
            <BarList
              rows={[
                { label: 'Camping & outdoor', value: 412 },
                { label: 'Optics', value: 188 },
                { label: 'Fishing', value: 141 },
              ]}
            />
          </ChartCard>
        </Panel>

        <Panel title="Funnel & split" note="Opacity steps of 14% down the funnel; the split is one pill at 100% against 40%.">
          <ChartCard label="Drop-off">
            <Funnel
              steps={[
                { label: 'Visits', value: 48200 },
                { label: 'Views', value: 21900 },
                { label: 'Paid', value: 1160 },
              ]}
            />
          </ChartCard>
          <ChartCard label="Listing types">
            <Split a={{ label: 'Buy Now', value: 71 }} b={{ label: 'Auction', value: 29 }} />
            <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
              Offers are an add-on on either type, never a third mode.
            </span>
          </ChartCard>
        </Panel>

        <Panel title="Warden" note="What it found, what it fixed alone, and what it wants permission to do — with the command and its output verbatim.">
          <WardenMessage kind="fixed" time="12:44" footnote="safe-list action · logged">
            The shipping poller went 42 minutes stale. I restarted the worker — it ran clean at 12:43
            and tracking is flowing again. Nothing for you to do.
          </WardenMessage>
          <WardenMessage
            kind="proposal"
            time="13:20"
            footnote="diagnosis via Claude API · config and log excerpts only, secrets stripped"
            diff={'-  client_max_body_size 8m;\n+  client_max_body_size 16m;'}
            actions={
              <>
                <Button variant="primary">Apply the fix…</Button>
                <Button variant="secondary">Show the diff</Button>
                <Button variant="ghost">Ask more</Button>
              </>
            }
          >
            Photo uploads are failing now and then — 3 of 41 in the last hour. The new server block
            caps uploads at 8 MB while the app allows 12 MB. That touches server config, so it waits
            for you.
          </WardenMessage>
          <OperatorMessage time="13:22">
            Do it. And if it fails again tonight, rather leave it for the morning.
          </OperatorMessage>
          <WardenMessage
            kind="ran"
            time="13:23"
            output={'$ nginx -t && systemctl reload nginx\nnginx: configuration file /etc/nginx/nginx.conf test is successful'}
            footnote="logged with your instruction"
          >
            Applied and reloaded. I will hold overnight retries until 06:00 — instruction saved.
          </WardenMessage>
          <ChatComposer value={chat} onChange={setChat} onSend={() => setChat('')} />
        </Panel>
      </Grid>

      <Panel title="Overlays" note="The only things on the surface that lift. Open them to check focus, Escape and the dim." wide>
        <Row>
          <Button variant="primary" onClick={() => setDrawer(true)}>Open the drawer</Button>
          <Button variant="secondary" onClick={() => setMoney(true)}>Open a money confirm</Button>
        </Row>
        <Hint>The undo toast is pinned bottom-centre and counting; it is a polite live region.</Hint>
      </Panel>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        typeLabel="Firearm transfer"
        reference="AU000212"
        icon={IconShield}
        title="Howa 1500 .308 — awaiting dealer verification"
        meta="@kudu_hunter → @rooikat · Bushveld Arms · lodged 26h ago"
        tags={<Tag kind="bad">26h waiting</Tag>}
        headerActions={<Button variant="ghost" trailingIcon={IconExternal}>Open order</Button>}
        note="Drawn with the gate ON, so the live decision exists. While PAYMENTS_LIVE is off both money controls render as the gated variant."
        footer={
          <>
            <Button variant="danger">Reject transfer…</Button>
            <span style={{ flex: 1 }} />
            <Button variant="primary" amount={formatRand(1840000)} icon={IconCheck}>
              Approve · release
            </Button>
          </>
        }
      >
        <Section label="Payment breakdown">
          <Kv k="Buyer paid" v={formatRand(1840000)} />
          <Kv k="Seller receives" v={formatRand(1730000)} />
          <Kv k="Commission" v={formatRand(92000)} />
          <Kv k="Gateway" v={formatRand(18000)} last />
        </Section>
        <Section label="Shipping timeline">
          <Timeline
            steps={[
              { title: 'Paid', sub: '25 Aug 14:12', state: 'done' },
              { title: 'Collected by Bob Go', sub: 'BG9920114', state: 'done' },
              { title: 'At the dealer', sub: 'awaiting SAPS 534', state: 'now' },
              { title: 'Handed over', state: 'todo' },
            ]}
          />
        </Section>
        <Section label="Documents" last>
          <span style={{ fontSize: 12.5, color: 'var(--dk-ink-2)' }}>
            SAPS 534, stock register and three firearm photographs are attached.
          </span>
        </Section>
      </Drawer>

      <MoneyDialog
        open={money}
        onCancel={() => setMoney(false)}
        onConfirm={() => setMoney(false)}
        title={<>Refund <span className="dk-mono">{formatRand(315000)}</span></>}
        rows={[
          { k: 'To', v: '@trailvark' },
          { k: 'From', v: 'Funds held on UM000431' },
          { k: 'Then', v: 'The dispute closes as refunded' },
        ]}
        confirmLabel="Refund"
        amount={formatRand(315000)}
      />

      <ReasonDialog
        open={reason}
        onCancel={() => setReason(false)}
        onConfirm={() => setReason(false)}
        title="Reject this listing"
        confirmLabel="Reject listing"
        noteHint="The seller sees this note. The reason above is what the system records."
        options={[
          { value: 'photos', label: "Photos are not the seller's own", consequence: 'counts as a strike' },
          { value: 'contact', label: 'Contact details in the description', consequence: 'counts as a strike' },
          { value: 'prohibited', label: 'Prohibited item', consequence: 'counts as a strike' },
          { value: 'other', label: 'Other' },
        ]}
      />

      <SearchPalette
        open={palette}
        onClose={() => setPalette(false)}
        query={query}
        onQueryChange={setQuery}
        results={[
          {
            group: 'Orders',
            ref: 'UM000431',
            title: 'Garmin inReach Mini 2',
            context: 'disputed',
            icon: IconChevronRight,
            onOpen: () => setPalette(false),
          },
          {
            group: 'Members',
            ref: '@trailvark',
            title: 'Buyer · 14 orders',
            context: 'verified',
            icon: IconChevronRight,
            onOpen: () => setPalette(false),
          },
        ]}
      />

      <UndoToast message="Approved UM000598" seconds={seconds} onUndo={() => setSeconds(10)} />
    </div>
  );
}

/* ── fixture furniture ─────────────────────────────────────────────────── */

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        gap: '40px 44px',
        alignItems: 'start',
      }}
    >
      {children}
    </div>
  );
}

function Panel({
  title,
  note,
  children,
  wide = false,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minWidth: 0,
        gridColumn: wide ? '1 / -1' : undefined,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.015em' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--dk-ink-3)', lineHeight: 1.45 }}>{note}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)', lineHeight: 1.5 }}>{children}</span>;
}
