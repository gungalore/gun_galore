'use client';

import { useAuth } from '@clerk/nextjs';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StepAccordion, StepStatus } from '@/components/step-accordion';
import {
  FollowUp,
  MotivationApiError,
  MotivationDetail,
  MotivationField,
  DocumentStatus,
  PickableKind,
  ProfileOffer,
  Suggestion,
  UploadRow,
  SAPS271_FILL,
  SAPS271_OPT_KEY,
  groupBySection,
  partitionByDocument,
  motivationsApi,
  visibleFields,
} from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// The motivation wizard.
//
// One long sitting — fifteen minutes of someone's circumstances, their safe,
// their history — so the two things that matter most are that NOTHING IS EVER
// LOST and that they always know what is still outstanding.
//
// AUTOSAVE, DEBOUNCED, PLUS A LOCAL DRAFT. The server is the record, but a
// dropped connection halfway through a paragraph about a robbery must not cost
// someone that paragraph. localStorage holds what has been typed since the last
// successful save, and is cleared only once the server confirms.
//
// THE QUESTIONS COME FROM THE SERVER. The field registry is 170 definitions
// with conditional visibility and per-field caps; a second copy here would
// drift on the first change, and the two halves disagreeing about what is
// required is a bug nobody sees until an application will not generate.
//
// ⚠️ NO OUTCOME LANGUAGE. Not "improves your chances", not "approval likely",
// no success rates — not here, not in the document, not in an email. We sell
// structure and completeness, never odds.
// ────────────────────────────────────────────────────────────────────

const AUTOSAVE_MS = 1200;
const DRAFT_KEY = (id: string) => `motivation-draft:${id}`;

// The "document type" menu is SERVED, not hard-coded here — see PickableKind
// in lib/motivations-api.ts for why. The server orders it so the next thing to
// photograph is the next thing in the list.

export default function MotivationWizardPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [detail, setDetail] = useState<MotivationDetail | null>(null);
  const [fields, setFields] = useState<MotivationField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [offer, setOffer] = useState<ProfileOffer | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [documents, setDocuments] = useState<DocumentStatus | null>(null);
  const [uploadKinds, setUploadKinds] = useState<PickableKind[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [messages, setMessages] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [expanded, setExpanded] = useState(1);
  const [furthest, setFurthest] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [testimonialConsent, setTestimonialConsent] = useState(false);
  // Values read off uploaded documents, waiting to be confirmed. NOT answers.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // A stable getter, so the effects below do not re-run every render just
  // because Clerk handed back a new function identity.
  const token = useCallback(() => getToken(), [getToken]);

  // One-shot restore. Without the ref this re-runs on every answers change and
  // fights the user's typing.
  const restored = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await motivationsApi.get(token, id);
        if (!alive) return;
        const fs = await motivationsApi.fields(token, d.licenceType);
        if (!alive) return;

        // A local draft newer than the server's copy wins — it exists only
        // because a save did not complete.
        let merged = d.answers ?? {};
        if (!restored.current) {
          restored.current = true;
          try {
            const raw = localStorage.getItem(DRAFT_KEY(id));
            if (raw) merged = { ...merged, ...(JSON.parse(raw) as object) };
          } catch {
            /* a corrupt draft is not worth failing the page over */
          }
        }

        setDetail(d);
        setFields(fs.fields);
        setAnswers(merged);
        const up = await motivationsApi.uploads(token, id);
        setUploads(up.files);
        setDocuments(up.documents);
        setUploadKinds(up.kinds ?? []);
        setMessages(await motivationsApi.messages(token, id));
        try {
          setOffer(await motivationsApi.profileOffer(token, id));
        } catch {
          /* prefill is a courtesy; never block the wizard on it */
        }
      } catch (e) {
        if (alive) {
          setError(
            e instanceof MotivationApiError
              ? e.message
              : 'We could not open this application.',
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, token]);

  // Debounced autosave. The timer is keyed on the answers object, so a burst of
  // typing collapses into one request once they pause.
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current || !detail) return;
    localStorage.setItem(DRAFT_KEY(id), JSON.stringify(answers));
    setSaving('saving');
    const t = setTimeout(async () => {
      try {
        const res = await motivationsApi.saveAnswers(token, id, answers);
        setDetail((d) => (d ? { ...d, missingRequired: res.missingRequired } : d));
        // The overlap check is computed server-side from the calibres, so a
        // change to any of them can turn the question on or off. Re-read it
        // rather than leave a stale answer on screen.
        if (overlapDirty.current) {
          overlapDirty.current = false;
          try {
            const fresh = await motivationsApi.get(token, id);
            setDetail((d) => (d ? { ...d, overlap: fresh.overlap } : fresh));
          } catch {
            /* the question is a courtesy; never break the save over it */
          }
        }
        // Cleared only once the server has it. Clearing on send would lose the
        // draft precisely when the request failed.
        localStorage.removeItem(DRAFT_KEY(id));
        dirty.current = false;
        setSaving('saved');
      } catch {
        setSaving('error');
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [answers, detail, id, token]);

  // Set when an edit could change the overlap verdict, so the next save
  // re-reads it instead of leaving a stale question on screen.
  const overlapDirty = useRef(false);
  const setAnswer = (key: string, value: string) => {
    dirty.current = true;
    if (key === 'firearm_calibre' || /^existing_firearm_\d+_calibre$/.test(key)) {
      overlapDirty.current = true;
    }
    setAnswers((a) => ({ ...a, [key]: value }));
  };

  const shown = useMemo(() => visibleFields(fields, answers), [fields, answers]);

  /**
   * How many firearms-you-already-own rows to show.
   *
   * The SAPS 271 has room for fourteen and the registry carries six, but
   * rendering six empty rows of six columns is thirty-six boxes in front of
   * someone who probably owns one firearm — which reads as a demand rather than
   * a form. Operator, 2026-08-19: start with one, and add another on request.
   *
   * A row counts as started once its calibre is filled, since that is the
   * column the overlap check actually needs.
   */
  const ownedRowsFilled = useMemo(() => {
    let n = 0;
    for (let i = 1; i <= 6; i++) {
      if ((answers[`existing_firearm_${i}_calibre`] ?? '').trim()) n = i;
    }
    return n;
  }, [answers]);
  const [ownedRowsShown, setOwnedRowsShown] = useState(1);
  // The review card is READ-ONLY until asked otherwise. Rendering thirteen
  // filled inputs is the wall of boxes this whole change exists to remove.
  const [editingRead, setEditingRead] = useState(false);
  const ownedRows = Math.max(1, ownedRowsFilled, ownedRowsShown);

  const { sections, read: readFromDocuments } = useMemo(() => {
    // Hide the rows beyond the ones in play. They stay in the registry — the
    // form has them and the server still accepts them — they are simply not
    // put in front of someone who does not need them.
    const visible = shown.filter((f) => {
      // The "why do you need both" question only exists when there IS an
      // overlap. Asked unconditionally it is a puzzling demand; asked at the
      // right moment it is the single most useful question on the form.
      if (f.key === 'overlap_justification') {
        return detail?.overlap?.needsJustification === true;
      }
      const m = /^existing_firearm_(\d+)_/.exec(f.key);
      return !m || Number(m[1]) <= ownedRows;
    });
    // Anything a document already answered leaves the question flow and
    // becomes a line in the review card below.
    const split = partitionByDocument(visible, answers);
    return { sections: groupBySection(split.questions), read: split.fromDocuments };
  }, [shown, ownedRows, detail?.overlap?.needsJustification, answers]);
  const outstanding = detail?.missingRequired ?? [];
  // A question stays open until the applicant has REPLIED to it — a user
  // message with the same fieldKey later in the thread. The old check hid any
  // question whose field had text, but the gate asks about THIN fields, which
  // by definition have text: a failed gate stranded the applicant on
  // NEEDS_MORE_INFO with no visible questions at all.
  const openQuestions = useMemo(
    () =>
      messages.filter(
        (m, i) =>
          m.role === 'assistant' &&
          !messages
            .slice(i + 1)
            .some((u) => u.role === 'user' && u.fieldKey === m.fieldKey),
      ),
    [messages],
  );

  /**
   * Status for one step.
   *
   * `answered` matters as much as `missing`. A section whose fields are ALL
   * OPTIONAL has nothing missing the moment it appears, and the first version
   * turned it green immediately — telling someone a section was done before
   * they had typed a word in it. Green now means "there is something in here
   * and nothing outstanding".
   */
  const stepStatus = (
    n: number,
    missing: number,
    answered: number,
  ): StepStatus => {
    if (answered > 0 && missing === 0) return 'complete';
    if (n === expanded) return 'active';
    // NOTHING IS EVER LOCKED.
    //
    // It used to lock any step past `furthest`, which froze the whole form on
    // return: the profile step does not render for an application that already
    // has one, so `expanded` pointed at a step that was not there, nothing was
    // active, and every remaining section sat locked and unclickable.
    //
    // Locking was wrong anyway. This is not a checkout — people fill a licence
    // application in the order their paperwork comes to hand, and a step they
    // cannot open is indistinguishable from a broken page.
    return 'idle';
  };

  /**
   * Toggle, not just open.
   *
   * Clicking the header of the step you are ON now COLLAPSES it. Previously
   * every click expanded, so the open step could never be shrunk and a long
   * section left no way to see the rest of the form. Operator, 2026-08-19.
   */
  const go = (n: number) => {
    setExpanded((cur) => (cur === n ? 0 : n));
    setFurthest((f) => Math.max(f, n));
  };

  // Open the first section that still has something outstanding, rather than
  // assuming step 1 exists. A returning applicant lands on the work left to do.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || loading || !sections.length) return;
    opened.current = true;
    const firstIncomplete = sections.findIndex((sec) =>
      sec.fields.some((f) => outstanding.includes(f.key)),
    );
    setExpanded(firstIncomplete >= 0 ? firstIncomplete + 2 : 0);
  }, [loading, sections, outstanding]);

  if (loading) {
    return <main className="mx-auto max-w-3xl p-6">Loading your application…</main>;
  }
  if (error || !detail) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-[var(--red)]">{error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Your firearm licence motivation</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Reference {detail.referenceNumber}. Everything stays here until you
          print it — nothing is sent to SAPS by us.
        </p>
        <p className="mt-2 text-xs text-[var(--text-tertiary-on-card)]" aria-live="polite">
          {saving === 'saving' && 'Saving…'}
          {saving === 'saved' && 'Saved'}
          {saving === 'error' &&
            'We could not save just now — your answers are kept on this device and will save again shortly.'}
        </p>
      </header>

      {/* Documents FIRST.
        *
        * Operator, 2026-08-19: take the documents up front, because there is a
        * lot we can read off them. An ID carries the name and ID number (and
        * therefore date of birth, age, gender and citizenship); a competency
        * certificate its number and dates; a licence the make, calibre and
        * serial of a firearm they already own — which is exactly what the
        * overlap check needs. Re-typing all that off a card in your hand is the
        * part of a form people abandon. */}
      <section className="mb-6 rounded border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <h2 className="font-medium">Start with your documents</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Photograph or upload what you already have and we will read what we
          can off them, so you type less. You confirm everything before it goes
          on the form. They are stored encrypted on our own server, are never
          public, and each becomes a lettered annexure.
        </p>
        {documents && documents.needs.length > 0 && (
          <div className="mt-3 rounded border border-[var(--border)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border-divider)] bg-[var(--bg-inset)] px-3 py-2">
              <span className="text-sm font-medium">
                {documents.missingRequired.length === 0
                  ? 'You have everything SAPS asks for'
                  : `${documents.requiredHave} of ${documents.requiredTotal} required documents`}
              </span>
              {documents.extras.length > 0 && (
                <span className="text-xs text-[var(--text-tertiary-on-card)]">
                  + {documents.extras.length} extra attached
                </span>
              )}
            </div>
            <ul className="divide-y divide-[var(--border-divider)]">
              {documents.needs.map((n) => (
                <li key={n.kind} className="flex gap-3 p-3 text-sm">
                  <span aria-hidden className="pt-0.5">
                    {n.have ? '✓' : n.tier === 'required' ? '•' : '○'}
                  </span>
                  <span className="flex-1">
                    <span className={n.have ? 'text-[var(--text-tertiary-on-card)] line-through' : ''}>
                      {n.label}
                    </span>
                    {/* "Required" means SAPS requires it — never that we
                        refuse to proceed. Someone whose competency is still
                        being processed should be drafting a motivation now. */}
                    {!n.have && n.tier === 'required' && (
                      <span className="ml-2 rounded bg-[var(--gold-wash)] px-1.5 py-0.5 text-xs">
                        SAPS needs this
                      </span>
                    )}
                    {!n.have && n.tier === 'strengthens' && (
                      <span className="ml-2 text-xs text-[var(--text-tertiary-on-card)]">
                        optional — but it helps
                      </span>
                    )}
                    {!n.have && n.why && (
                      <span className="mt-0.5 block text-xs text-[var(--text-tertiary-on-card)]">
                        {n.why}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-[var(--border-divider)] px-3 py-2 text-xs text-[var(--text-tertiary-on-card)]">
              Anything else you want to attach as supporting evidence is
              welcome — choose &ldquo;Something else&rdquo; below. We will
              letter it as an annexure like the rest.
            </p>
          </div>
        )}

        <UploadPanel
          uploads={uploads}
          kinds={uploadKinds}
          onAdd={async (kind, file) => {
            const row = await motivationsApi.addUpload(token, id, kind, file);
            setUploads((u) => [...u, row]);
            // Re-read what is still needed: this upload may have satisfied a
            // requirement, and the list must stop asking for it.
            motivationsApi
              .uploads(token, id)
              .then((up) => {
                setDocuments(up.documents);
                setUploadKinds(up.kinds ?? []);
              })
              .catch(() => undefined);
            if (row.suggestions?.length) {
              // Only offer values for fields that are still empty — anything
              // already answered stays exactly as they typed it.
              setSuggestions((cur) => [
                ...cur,
                ...row.suggestions!.filter(
                  (sg) =>
                    !(answers[sg.key] ?? '').trim() &&
                    !cur.some((c) => c.key === sg.key),
                ),
              ]);
            }
          }}
          onRemove={async (uploadId) => {
            await motivationsApi.removeUpload(token, id, uploadId);
            setUploads((u) => u.filter((x) => x.id !== uploadId));
            motivationsApi
              .uploads(token, id)
              .then((up) => {
                setDocuments(up.documents);
                setUploadKinds(up.kinds ?? []);
              })
              .catch(() => undefined);
          }}
        />

        {suggestions.length > 0 && (
          <div className="mt-4 rounded border border-[rgba(47,158,107,0.38)] bg-[rgba(47,158,107,0.10)] p-3">
            <h3 className="text-sm font-medium">
              We read {suggestions.length}{' '}
              {suggestions.length === 1 ? 'thing' : 'things'} off that
            </h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Check each one against the document before you accept it — you are
              the one who signs this.
            </p>
            <ul className="mt-2 space-y-2">
              {suggestions.map((sg) => (
                <li key={sg.key} className="text-sm">
                  <span className="text-[var(--text-secondary)]">{sg.label}: </span>
                  <span className="font-medium">{sg.value}</span>
                  <span className="block text-xs text-[var(--text-tertiary-on-card)]">
                    from {sg.from}
                    {sg.note ? ` — ${sg.note}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded bg-[var(--red)] px-3 py-1.5 text-sm text-white hover:bg-[var(--red-hover)]"
                onClick={async () => {
                  const accept = Object.fromEntries(
                    suggestions.map((sg) => [sg.key, sg.value]),
                  );
                  await motivationsApi.applyExtraction(token, id, accept);
                  const d = await motivationsApi.get(token, id);
                  setDetail(d);
                  setAnswers((a) => ({ ...d.answers, ...a, ...accept }));
                  setSuggestions([]);
                }}
              >
                These are right — use them
              </button>
              <button
                type="button"
                className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
                onClick={() => setSuggestions([])}
              >
                No, I will type them
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 1 — the profile offer */}
      {offer && offer.fields.length > 0 && !offer.alreadyConsented && (
        <StepAccordion
          number={1}
          title="Use what we already have?"
          description={offer.note}
          status={stepStatus(1, 0, offer.alreadyConsented ? 1 : 0)}
          expanded={expanded === 1}
          onToggle={() => go(1)}
          hideContinue
        >
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-secondary)]">
              We can fill these in from your All Outdoor profile. Nothing is
              copied until you say so, and anything you have already typed is
              left alone.
            </p>
            <ul className="divide-y divide-[var(--border-divider)] rounded border border-[var(--border)]">
              {offer.fields.map((f) => (
                <li key={f.key} className="flex justify-between gap-4 p-3 text-sm">
                  <span className="text-[var(--text-secondary)]">{f.label}</span>
                  <span className="text-right">
                    <span className="font-medium">{f.value}</span>
                    <span className="block text-xs text-[var(--text-tertiary-on-card)]">
                      from {f.from}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-[var(--red)] px-4 py-2 text-sm text-white hover:bg-[var(--red-hover)]"
                onClick={async () => {
                  const res = await motivationsApi.useProfile(token, id);
                  const d = await motivationsApi.get(token, id);
                  setAnswers((a) => ({ ...d.answers, ...a }));
                  setDetail(d);
                  setOffer((o) =>
                    o ? { ...o, alreadyConsented: true } : o,
                  );
                  if (res.filled >= 0) go(2);
                }}
              >
                Yes, use these
              </button>
              <button
                type="button"
                className="rounded border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card-hover)]"
                onClick={() => go(2)}
              >
                No, I will type them
              </button>
            </div>
          </div>
        </StepAccordion>
      )}

      {/* What the documents already answered. NOT a question section — it is
          a receipt, so the applicant can see we read it and correct us if we
          read it wrong. POPIA requires correctability; this is where it
          lives. */}
      {readFromDocuments.length > 0 && (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">From your documents</p>
            <button
              type="button"
              className="text-xs text-[var(--text-secondary)] underline"
              onClick={() => setEditingRead((v) => !v)}
            >
              {editingRead ? 'Done' : 'Something looks wrong'}
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--text-tertiary-on-card)]">
            We read these off what you uploaded, so we are not asking you to
            type them again. The document as printed always governs — if
            anything here does not match it, change it.
          </p>
          {editingRead ? (
            <div className="mt-3 space-y-4">
              {readFromDocuments.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={answers[f.key] ?? ''}
                  missing={outstanding.includes(f.key)}
                  onChange={(v) => setAnswer(f.key, v)}
                />
              ))}
            </div>
          ) : (
            <dl className="mt-3 divide-y divide-[var(--border-divider)]">
              {readFromDocuments.map((f) => (
                <div key={f.key} className="flex gap-3 py-2 text-sm">
                  <dt className="w-1/2 shrink-0 text-[var(--text-secondary)]">
                    {f.label}
                  </dt>
                  <dd className="flex-1 break-words">{answers[f.key]}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {/* 2 — the questions, straight from the registry */}
      {sections.map((sec, i) => {
        const n = i + 2;
        const missingHere = sec.fields.filter((f) =>
          outstanding.includes(f.key),
        ).length;
        const answeredHere = sec.fields.filter((f) =>
          (answers[f.key] ?? '').trim(),
        ).length;
        const isOwned = sec.section === 'Firearms you already own';
        return (
          <StepAccordion
            key={sec.section}
            number={n}
            title={sec.section}
            status={stepStatus(n, missingHere, answeredHere)}
            expanded={expanded === n}
            onToggle={() => go(n)}
            summary={
              missingHere > 0
                ? `${missingHere} still to answer`
                : answeredHere > 0
                  ? 'Done'
                  : 'Nothing yet'
            }
            onContinue={() => go(n + 1)}
          >
            <div className="space-y-4">
              {isOwned && detail.overlap?.needsJustification && (
                <div className="rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3 text-sm">
                  {/* Shown while they are still filling the form. Someone who
                      has just typed their existing firearms is in the best
                      position to explain why they need both — and asked here it
                      reads as help, where asked after a rejection it reads as a
                      hurdle. */}
                  <p className="font-medium">Worth explaining</p>
                  <p className="mt-1 text-[var(--text-secondary)]">
                    {detail.overlap.prompt}
                  </p>
                </div>
              )}
              {sec.fields.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={answers[f.key] ?? ''}
                  missing={outstanding.includes(f.key)}
                  onChange={(v) => setAnswer(f.key, v)}
                />
              ))}

              {isOwned && ownedRows < 6 && (
                <label className="flex items-center gap-2 pt-2 text-sm">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => setOwnedRowsShown(ownedRows + 1)}
                  />
                  <span>I own another firearm as well</span>
                </label>
              )}
              {isOwned && ownedRows >= 6 && (
                <p className="pt-2 text-xs text-[var(--text-tertiary-on-card)]">
                  That is as many as we can print on the form. If you own more,
                  write the rest in by hand.
                </p>
              )}
            </div>
          </StepAccordion>
        );
      })}

      {/* 3 — Boet's follow-ups */}
      {openQuestions.length > 0 && (
        <section className="mt-6 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-4">
          <h2 className="font-medium">A few things Boet wants to ask</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            These are the answers that were too thin to build a strong document
            from.
          </p>
          <ul className="mt-3 space-y-4">
            {openQuestions.map((q) => (
              <li key={q.id}>
                <p className="text-sm font-medium">{q.content}</p>
                <FollowUpAnswer
                  onSubmit={async (text) => {
                    await motivationsApi.answerFollowUp(token, id, q.id, text);
                    setMessages(await motivationsApi.messages(token, id));
                    setDetail(await motivationsApi.get(token, id));
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 5 — declaration and generate */}
      <section className="mt-6 rounded border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <h2 className="font-medium">Before we prepare it</h2>
        {outstanding.length > 0 ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {outstanding.length} answer{outstanding.length === 1 ? '' : 's'}{' '}
            still to give. The sections above show which.
          </p>
        ) : (
          <>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={testimonialConsent}
                onChange={(e) => setTestimonialConsent(e.target.checked)}
              />
              <span>
                You may ask me later how my application went. (Optional.)
              </span>
            </label>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              By continuing you confirm that everything you have told us is
              true, and that you submit the motivation as your own. It is not
              legal advice.
            </p>
            <button
              type="button"
              disabled={generating}
              className="mt-3 rounded bg-[var(--red)] px-4 py-2 text-sm text-white hover:bg-[var(--red-hover)] disabled:opacity-50"
              onClick={async () => {
                setGenerating(true);
                setError(null);
                try {
                  await motivationsApi.acceptDeclaration(
                    token,
                    id,
                    testimonialConsent,
                  );
                  await motivationsApi.generate(token, id);
                  const d = await motivationsApi.get(token, id);
                  setDetail(d);
                  setMessages(await motivationsApi.messages(token, id));
                  if (d.status === 'COMPLETED') router.refresh();
                } catch (e) {
                  setError(
                    e instanceof MotivationApiError
                      ? e.message
                      : 'We could not prepare the document just now.',
                  );
                } finally {
                  setGenerating(false);
                }
              }}
            >
              {generating ? 'Preparing…' : 'Prepare my motivation'}
            </button>
          </>
        )}

        {detail.status === 'COMPLETED' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              className="rounded border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card-hover)]"
              href={motivationsApi.pdfUrl(id)}
              target="_blank"
              rel="noreferrer"
            >
              Open your motivation
            </a>
            {(answers[SAPS271_OPT_KEY] ?? '') === SAPS271_FILL && (
              <a
                className="rounded border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card-hover)]"
                href={motivationsApi.saps271Url(id)}
                target="_blank"
                rel="noreferrer"
              >
                Open your pre-filled SAPS 271
              </a>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-[var(--red)]">{error}</p>}
      </section>

      {/* Deleting was possible on the API from the start and had no way in
          from the wizard. It is a real erasure — the encrypted documents go
          with it — so it asks first and says what it is about to do. */}
      <section className="mt-8 border-t border-[var(--border-divider)] pt-4">
        <button
          type="button"
          disabled={deleting}
          className="text-sm text-[var(--red)] underline disabled:opacity-50"
          onClick={async () => {
            const ok = window.confirm(
              `Delete this application (${detail.referenceNumber})?\n\nThis removes your answers, your uploaded documents and the finished motivation. It cannot be undone.`,
            );
            if (!ok) return;
            setDeleting(true);
            try {
              await motivationsApi.erase(token, id);
              // The local draft would otherwise resurrect the answers on a
              // new application with the same id — belt and braces.
              localStorage.removeItem(DRAFT_KEY(id));
              router.push('/motivations');
            } catch (e) {
              setError(
                e instanceof MotivationApiError
                  ? e.message
                  : 'We could not delete it just now.',
              );
              setDeleting(false);
            }
          }}
        >
          {deleting ? 'Deleting…' : 'Delete this application'}
        </button>
        <p className="mt-1 text-xs text-[var(--text-tertiary-on-card)]">
          Removes everything, including the documents you uploaded.
        </p>
      </section>
    </main>
  );
}

/** One question, rendered from its registry definition. */
function FieldInput({
  field,
  value,
  missing,
  onChange,
}: {
  field: MotivationField;
  value: string;
  missing: boolean;
  onChange: (v: string) => void;
}) {
  // EXPLICIT background and colour on every control.
  //
  // The site is dark (--bg #0f0f0f) and <body> sets near-white text, but a
  // <select> or <input> with no background of its own gets the BROWSER's
  // default light chrome — so the inherited white text landed on white and was
  // invisible. Operator, 2026-08-19: "I can't read the dropdown menus".
  //
  // `[&>option]` covers the popup list too: on Windows the option list is
  // painted by the OS and does not inherit the select's colours.
  const base =
    'mt-1 w-full rounded border px-3 py-2 text-sm ' +
    'bg-[var(--bg-inset)] text-[var(--text-primary)] ' +
    '[&>option]:bg-[var(--bg-card)] [&>option]:text-[var(--text-primary)] ' +
    'focus:border-[var(--border-hover)] focus:outline-none ' +
    (missing ? 'border-[var(--warning)]' : 'border-[var(--border)]');

  return (
    <div>
      <label className="block text-sm font-medium" htmlFor={field.key}>
        {field.label}
        {field.required && <span aria-hidden> *</span>}
      </label>
      {field.help && (
        <p className="mt-0.5 text-xs text-[var(--text-tertiary-on-card)]">{field.help}</p>
      )}

      {field.kind === 'long' && (
        <textarea
          id={field.key}
          className={base}
          rows={5}
          maxLength={field.maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {(field.kind === 'short' || field.kind === 'date') && (
        <input
          id={field.key}
          type={field.kind === 'date' ? 'date' : 'text'}
          className={base}
          maxLength={field.maxLength}
          inputMode={/(^|_)id_number$/.test(field.key) ? 'numeric' : undefined}
          value={value}
          onChange={(e) =>
            onChange(
              // An SA ID is digits only, and people type it with spaces. The
              // maxLength cap counts characters, so the spaces used to stop
              // the last digits from ever being typed.
              /(^|_)id_number$/.test(field.key)
                ? e.target.value.replace(/\D/g, '')
                : e.target.value,
            )
          }
        />
      )}

      {(field.kind === 'choice' || field.kind === 'yesno') && (
        <select
          id={field.key}
          className={base}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose…</option>
          {(field.choices ?? ['No', 'Yes']).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}

      {field.kind === 'multi' && (
        <div className="mt-1 flex flex-wrap gap-3">
          {(field.choices ?? []).map((c) => {
            const picked = value
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean);
            return (
              <label key={c} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(c)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...picked, c]
                      : picked.filter((x) => x !== c);
                    // Normalised to the offered order so the server's own
                    // ordering and ours agree.
                    onChange(
                      (field.choices ?? [])
                        .filter((x) => next.includes(x))
                        .join(', '),
                    );
                  }}
                />
                {c}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FollowUpAnswer({ onSubmit }: { onSubmit: (t: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2">
      <textarea
        className="w-full rounded border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-sm text-[var(--text-primary)]"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        className="mt-1 rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          try {
            await onSubmit(text.trim());
            setText('');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : 'Answer'}
      </button>
    </div>
  );
}

function UploadPanel({
  uploads,
  kinds,
  onAdd,
  onRemove,
}: {
  uploads: UploadRow[];
  kinds: PickableKind[];
  onAdd: (kind: string, file: File) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  // Empty string until the list arrives, and the file input stays disabled
  // until then — posting an empty kind would 400 with nothing useful to show.
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Follow the server's first choice, which is the first thing still needed.
  // Only while nothing has been picked: re-selecting under the applicant after
  // they chose would be the wizard arguing with them.
  useEffect(() => {
    if (!kind && kinds.length) setKind(kinds[0].kind);
  }, [kind, kinds]);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-[var(--border)] px-3 py-2 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Document type"
        >
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
              {/* "needed" means STILL OUTSTANDING, not "is on the required
                  list" — a tag that stays put after the photograph is attached
                  is a tag nobody reads. */}
              {k.tier === 'required' && !k.have ? ' — needed' : ''}
            </option>
          ))}
        </select>
        <input
          type="file"
          className="text-sm"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={busy || !kind}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setErr(null);
            try {
              await onAdd(kind, file);
            } catch (ex) {
              setErr(
                ex instanceof MotivationApiError
                  ? ex.message
                  : 'That upload did not work.',
              );
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }}
        />
      </div>
      {err && <p className="mt-2 text-sm text-[var(--red)]">{err}</p>}

      <ul className="mt-3 divide-y divide-[var(--border-divider)] rounded border border-[var(--border)]">
        {uploads.length === 0 && (
          <li className="p-3 text-sm text-[var(--text-tertiary-on-card)]">Nothing added yet.</li>
        )}
        {uploads.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <span>
              {u.annexure && (
                <span className="mr-2 rounded bg-[var(--bg-inset)] px-1.5 py-0.5 text-xs">
                  Annexure {u.annexure}
                </span>
              )}
              {u.label}
              {!u.available && (
                <span className="ml-2 text-xs text-[var(--text-tertiary-on-card)]">
                  (deleted under our retention policy)
                </span>
              )}
            </span>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => onRemove(u.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
