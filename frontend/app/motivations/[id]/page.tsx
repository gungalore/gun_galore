'use client';

import { useAuth } from '@clerk/nextjs';
import DateField from '@/components/date-field';
import FilePickerButton from '@/components/file-picker-button';
import ScanButton from '@/components/scan/scan-button';
import LibraryPicker from '@/components/library-picker';
import DocumentChecklist, {
  ChecklistRow,
} from '@/components/document-checklist';
import { shapeForKind } from '@/lib/scan/shapes';
import LicenceCentreOfferPanel from '@/components/licence-centre-offer-panel';
import MotivationChecklistPanel from '@/components/motivation-checklist-panel';
import MotivationTemplatePicker from '@/components/motivation-template-picker';
import { formatLong, parseIso, todayYmd } from '@/lib/date-picker-model';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StepAccordion, StepStatus } from '@/components/step-accordion';
import {
  FollowUp,
  MotivationApiError,
  MotivationDetail,
  MotivationField,
  DocumentStatus,
  LibraryItem,
  LicenceCentreOffer,
  PickableKind,
  ProfileOffer,
  Suggestion,
  AddedUpload,
  UploadRow,
  SAPS271_FILL,
  SAPS271_OPT_KEY,
  type Colourway,
  type TemplateCatalogue,
  type TemplateFormat,
  groupBySection,
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

/**
 * The pack checklist, behind "I have read it".
 *
 * ⚠️ THE ACKNOWLEDGEMENT IS LOCAL AND MEANS NOTHING TO THE SERVER, which is
 * the honest shape for it: it decides when a member is ready to look at a
 * list, and nothing else. Kept in localStorage beside the tick state the
 * panel itself already stores there, so it survives a reload on the machine
 * where the work is happening — and if it does not survive, the cost is one
 * more press of a button.
 */
function PackChecklistGate({
  motivationId,
  token,
}: {
  motivationId: string;
  token: () => Promise<string | null>;
}) {
  const key = `gg-motivation-pack-ready:${motivationId}`;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setReady(window.localStorage.getItem(key) === '1');
    } catch {
      // Private mode, or storage disabled. The button simply asks again.
    }
  }, [key]);

  if (!ready) {
    return (
      <section className="mt-6 rounded border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <h2 className="font-medium">Ready to take it in?</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Read your motivation first. When you are happy with it, we will show
          you everything to take to the police station with it.
        </p>
        <button
          type="button"
          className="mt-3 rounded bg-[var(--red)] px-4 py-2 text-sm text-white hover:bg-[var(--red-hover)]"
          onClick={() => {
            setReady(true);
            try {
              window.localStorage.setItem(key, '1');
            } catch {
              // See above — the list still opens for this visit.
            }
          }}
        >
          I have read it — show me the list
        </button>
      </section>
    );
  }

  return <MotivationChecklistPanel token={token} motivationId={motivationId} />;
}

/**
 * Which KIND a file picked on this row should be filed as.
 *
 * ⚠️ THE SAFE ROW IS THREE KINDS, and a file has to be one of them — nothing
 * on the stored row records which shot a photograph is. So the row hands over
 * the first of its parts that is still missing: press the button three times
 * and you fill closed, then half-open, then bolts, in the order a DFO reads
 * them. Every other row is simply its own kind.
 */
function uploadKindFor(row: ChecklistRow | null): string {
  if (!row) return '';
  if (!row.parts?.length) return row.kind;
  return (row.parts.find((p) => !p.have) ?? row.parts[0]).kind;
}

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
  /** Registered fields the server would not store. See the autosave effect. */
  const [refused, setRefused] = useState<string[]>([]);
  /** The draft, once asked for. Never fetched with the detail — it is long. */
  const [draft, setDraft] = useState<{
    text: string;
    qualityScore: number | null;
  } | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [expanded, setExpanded] = useState(1);
  const [furthest, setFurthest] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [testimonialConsent, setTestimonialConsent] = useState(false);
  // Values read off uploaded documents, waiting to be confirmed. NOT answers.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // ── The template picker ─────────────────────────────────────
  //
  // ⚠️ THE SELECTION IS HELD LOCALLY AND APPLIED OPTIMISTICALLY. Picking a
  // colour has to recolour the preview in the same frame the finger lifts; a
  // swatch that waits for a round trip before it moves reads as broken, and
  // this is the one control on the page a member will press repeatedly just
  // to look at the result.
  //
  // Safe to do here precisely because it is NOT an answer: the worst case of
  // a failed save is a document set in the previous colour, which is why the
  // failure line says so rather than silently reverting under their cursor.
  const [catalogue, setCatalogue] = useState<TemplateCatalogue | null>(null);
  const [template, setTemplate] = useState<{
    format: TemplateFormat;
    colourway: Colourway;
  }>({ format: 'standard', colourway: 'slate' });
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

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
        // The template picker. Its own try, and deliberately last: a
        // catalogue that will not load must cost the member nothing more than
        // the picker — the document renders in the default template either
        // way, so failing the whole page over a colour chart would be absurd.
        try {
          setCatalogue(await motivationsApi.templates(token));
          if (d.template) setTemplate(d.template);
        } catch {
          /* no picker; the standard template still renders */
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

  /**
   * Apply a template choice.
   *
   * ⚠️ SENDS ONLY WHAT CHANGED. Spreading the whole selection would mean a
   * colour tap also rewrites the format, and two quick taps on different
   * controls would race with one another's stale copy — the second request
   * carrying the first's pre-click format and undoing it.
   */
  const chooseTemplate = useCallback(
    async (choice: { format?: TemplateFormat; colourway?: Colourway }) => {
      setTemplate((t) => ({ ...t, ...choice }));
      setTemplateError(null);
      setTemplateSaving(true);
      try {
        const saved = await motivationsApi.setTemplate(token, id, choice);
        setTemplate(saved);
        setDetail((d) => (d ? { ...d, template: saved } : d));
      } catch (e) {
        // Left showing what they picked, not reverted under their cursor —
        // and told plainly which one the document would actually come out in.
        setTemplateError(
          e instanceof MotivationApiError
            ? e.message
            : 'We could not save that choice. Your document will use the last one that saved.',
        );
      } finally {
        setTemplateSaving(false);
      }
    },
    [id, token],
  );

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
        // ⚠️ A 200 IS NOT A SAVE. The server returns the registered fields
        // whose value it would not store, and saying "Saved" over that is how
        // an applicant loses an answer without ever being told: the box keeps
        // the text until the page reloads, then quietly comes back empty.
        // Reported by name, and the local draft is deliberately NOT cleared.
        if (res.refused?.length) {
          setRefused(res.refused);
          setSaving('error');
          return;
        }
        setRefused([]);
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
  /**
   * ONE UPLOAD, one code path.
   *
   * Called by the bulk picker, by the per-requirement rows beside each item on
   * the needs list, and by the "add a firearm licence" button. Lifted out of
   * the panel's props so those three cannot drift.
   */
  const addOneUpload = async (kind: string, file: File) => {
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
      // ⚠️ EMPTY BOXES ARE FILLED, FULL ONES ARE OFFERED. Two different
      // situations that used to get the same treatment.
      //
      // Attaching a competency certificate to the line that asks for one is
      // as clear a statement of intent as somebody can make, and making them
      // scroll to a suggestions panel to accept a number they just
      // photographed is a second question nobody asked. So an empty field
      // takes the value. onlyIfEmpty is checked inside setAnswers against the
      // state React actually holds, because one document can fill six boxes
      // and each call would otherwise race the same stale snapshot.
      //
      // A field they have ALREADY typed into is the opposite case and keeps
      // the old behaviour: it goes to the confirm list, because a misread
      // digit silently overwriting their own answer would be a false
      // statement on a form they sign.
      for (const sg of row.suggestions) {
        setAnswer(sg.key, sg.value, { onlyIfEmpty: true });
      }
      setSuggestions((cur) => [
        ...cur,
        ...row.suggestions!.filter(
          (sg) =>
            // `answers` is this render's snapshot, which is the right basis
            // here: it is what the member had typed when they pressed the
            // button. The autofill above deliberately reads fresher state.
            (answers[sg.key] ?? '').trim() &&
            (answers[sg.key] ?? '').trim() !== sg.value.trim() &&
            !cur.some((c) => c.key === sg.key),
        ),
      ]);
    }
    return row;
  };

  /**
   * Re-read the pack from the server.
   *
   * The phone uploads straight to the API over a handoff token, so nothing in
   * this tab hears about it — the list has to be asked rather than patched.
   */
  /**
   * Open one uploaded document in a new tab.
   *
   * ⚠️ THE TAB IS OPENED FIRST, SYNCHRONOUSLY, and filled once the bytes
   * arrive. Safari's popup blocker judges window.open by whether it happened
   * inside the click's own call stack — opening it after an await is a
   * blocked popup and, to the member, a View button that does nothing.
   */
  /**
   * Open an authenticated PDF in a new tab.
   *
   * Same shape as viewUpload below, for the same reasons: the tab is opened
   * SYNCHRONOUSLY (Safari blocks one opened after an await), without
   * 'noopener' (which by spec returns null and was the original blank-tab
   * bug), and a popup-blocked fall-through becomes a download rather than
   * replacing the page someone is working in.
   */
  const openAuthedPdf = useCallback(
    async (mint: () => Promise<string>, filename: string) => {
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      try {
        const url = await mint();
        if (tab) {
          tab.location.href = url;
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e) {
        tab?.close();
        setError(
          e instanceof MotivationApiError
            ? e.message
            : 'We could not open the document just now.',
        );
      }
    },
    [],
  );

  const viewUpload = useCallback(
    async (uploadId: string) => {
      // ⚠️ NO 'noopener' HERE, AND THAT IS THE WHOLE BUG. Per spec,
      // window.open with noopener returns NULL — the flag exists precisely to
      // sever the handle. So `tab` was always null: the blank tab opened and
      // was never filled, and the fallback then navigated the CURRENT window,
      // which is exactly what the operator saw.
      //
      // Dropping the flag is safe here in a way it would not be for a foreign
      // URL: this is a same-origin blob: URL we minted ourselves a line later,
      // so there is no cross-origin document to be handed a window reference.
      // `opener` is nulled anyway, which gets the flag's actual protection
      // without giving up the handle we need.
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      try {
        const url = await motivationsApi.uploadBlobUrl(token, id, uploadId);
        if (tab) {
          tab.location.href = url;
        } else {
          // Genuinely blocked. Hand it over rather than lose it — a download
          // beats replacing the page they are working in.
          const a = document.createElement('a');
          a.href = url;
          a.download = 'document';
          a.click();
        }
        // Long enough for the tab to have loaded it; the blob is pinned until
        // then and leaked for the life of the tab if we never let go.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e) {
        tab?.close();
        setUploadErr(
          e instanceof MotivationApiError
            ? e.message
            : 'We could not open that document.',
        );
      }
    },
    [token, id],
  );

  /**
   * What the vault could fill, per group, for the pickers under the fields.
   *
   * Loaded once beside the wizard rather than per field: the same endpoint
   * feeds the offer panel, and asking for it twice on one step would be two
   * decryptions of the same rows to draw two controls.
   */
  const [offerChoices, setOfferChoices] = useState<
    LicenceCentreOffer['choices'] | null
  >(null);
  const loadOffer = useCallback(async () => {
    try {
      const o = await motivationsApi.licenceCentreOffer(token, id);
      setOfferChoices(o.choices);
    } catch {
      // A vault we cannot read must not stop anybody typing the answer by
      // hand. The pickers simply do not appear.
    }
  }, [token, id]);
  useEffect(() => {
    void loadOffer();
  }, [loadOffer]);

  /** Documents this member already has, for the "use one I have" pickers. */
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  /**
   * Documents a section 16 pack could be handed straight away.
   *
   * ⚠️ OFFERED, NOT DONE. Attaching things to somebody's licence application
   * without asking is a decision made on their behalf about what a DFO will
   * see, and the one time it is wrong they find out at the counter. One press
   * takes all of them; the press is theirs.
   */
  const [suggested, setSuggested] = useState<LibraryItem[]>([]);
  const [suggestDone, setSuggestDone] = useState(false);
  const loadLibrary = useCallback(async () => {
    try {
      const r = await motivationsApi.library(token, id);
      setLibrary(r.items);
      setSuggested(r.suggested ?? []);
    } catch {
      // A library we cannot read costs a shortcut, not the ability to upload.
    }
  }, [token, id]);
  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  /**
   * Which line the single upload control is pointed at.
   *
   * ⚠️ IT DEFAULTS TO THE FIRST THING STILL MISSING, so the common case —
   * open the page, press the button — files the next document correctly
   * without a decision. It only moves when the member moves it.
   */
  const [pickedKind, setPickedKind] = useState('');

  const checklistRows: ChecklistRow[] = useMemo(() => {
    const needs = documents?.needs ?? [];
    return needs.map((n) => ({
      ...n,
      // ⚠️ THE SAFE ROW GATHERS ALL THREE SHOTS' FILES, not just its own kind.
      // One line stands for three kinds, so a photograph filed as the bolts
      // shot has to appear under it or the member sees an empty row and
      // uploads it again.
      files: uploads.filter((u) =>
        n.parts ? n.parts.some((p) => p.kind === u.kind) : u.kind === n.kind,
      ),
      reusable: library.filter((l) =>
        n.parts ? n.parts.some((p) => p.kind === l.kind) : l.kind === n.kind,
      ),
    }));
  }, [documents, uploads, library]);

  const selectedRow = checklistRows.find((r) => r.kind === pickedKind) ?? null;

  useEffect(() => {
    if (pickedKind) return;
    const next = checklistRows.find((r) => !r.have) ?? checklistRows[0];
    if (next) setPickedKind(next.kind);
  }, [checklistRows, pickedKind]);

  const refreshUploads = useCallback(async () => {
    const up = await motivationsApi.uploads(token, id);
    setUploads(up.files);
    setDocuments(up.documents);
    setUploadKinds(up.kinds ?? []);
  }, [token, id]);

  /**
   * KEEP THE DOCUMENTS IN STEP ACROSS DEVICES.
   *
   * ⚠️ THE SAME APPLICATION IS OPEN IN THREE PLACES. Somebody works on the
   * desktop, photographs their ID on the phone, and looks back at the laptop
   * — which is still showing the state it fetched when the page loaded. The
   * phone-handoff path already refreshed, because the desktop was watching
   * that particular session; a plain upload from the PWA had nothing watching
   * it at all, so the desktop sat there claiming the ID was still missing.
   *
   * Polled rather than pushed: a websocket for this would be a connection,
   * a reconnect policy and a server-side fan-out, to keep a checklist honest.
   *
   * ⚠️ ONLY WHILE THE TAB IS VISIBLE, and immediately on becoming visible —
   * which is the moment that actually matters, because it is when somebody
   * puts the phone down and looks back at the laptop. A background tab polling
   * every ten seconds is a battery and a bill for nothing.
   */
  useEffect(() => {
    let alive = true;
    // ⚠️ THIS POLL WAS COSTING 18 REQUESTS A MINUTE, standing still. Three
    // fetches every ten seconds, and the API allows 60 a minute per IP — so
    // an open wizard spent a third of the budget doing nothing, and with the
    // QR dialog's own poll running alongside it (another 30) a save or an
    // upload came back "Too Many Requests". The member was rate-limited by
    // our own screensaver.
    //
    // The three do not change at the same rate. What is attached to this pack
    // moves whenever a phone finishes a scan; the library and the vault offer
    // move only when a document is added somewhere else entirely. So uploads
    // every tick, the other two every third.
    let tick = 0;
    const sync = () => {
      if (document.visibilityState !== 'visible') return;
      // ⚠️ NOT WHILE AN OVERLAY IS UP. The scanner and the QR dialog both
      // mark themselves blocking, and both are doing their own polling with
      // their own refresh on completion — so this would be a second poll
      // behind a screen the member cannot even see the results through.
      if (document.querySelector('[data-blocking-overlay="true"]')) return;
      tick += 1;
      void refreshUploads().catch(() => undefined);
      if (tick % 3 === 1) {
        void loadLibrary().catch(() => undefined);
        // The offer was fetched once at mount and never again, so a
        // certificate photographed on a phone left the dropdowns frozen at
        // page-load state.
        void loadOffer().catch(() => undefined);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(() => {
      if (alive) sync();
    }, 20_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refreshUploads, loadLibrary, loadOffer]);

  /**
   * Photograph the document a field comes off, and fill the field from it.
   *
   * ⚠️ IT APPLIES THE READ VALUES DIRECTLY rather than dropping them into the
   * suggestions list further down the page. Somebody who has just pressed
   * "Photograph your competency certificate" while looking at the competency
   * box has said what they want as plainly as it can be said — asking them to
   * scroll and confirm is a second question nobody asked for. The general
   * upload path still routes through suggestions, because there the member
   * has not told us which box they had in mind.
   *
   * The file is filed as a real annexure at the same time, so it prints into
   * the pack with everything else.
   */
  /**
   * Attach a document the member already has.
   *
   * ⚠️ THE SERVER COPIES THE BYTES — nothing is uploaded from here. That is
   * the whole point: the second application should not ask for the ID again.
   * Any values the source had already been read for come back as suggestions
   * and are applied, exactly as if it had just been photographed.
   */
  const attachFromLibrary = useCallback(
    async (item: LibraryItem) => {
      const row = await motivationsApi.addFromLibrary(
        token,
        id,
        item.source,
        item.sourceId,
      );
      setUploads((u) => [...u, row]);
      // ⚠️ NEVER OVER AN ANSWER THEY TYPED. Unlike the per-field camera —
      // where pressing "photograph my competency certificate" IS the request
      // to replace what is in that box — this attaches a whole document and
      // may carry half a dozen values with it. Overwriting on that basis
      // would quietly undo work they did by hand.
      for (const sg of row.suggestions ?? []) {
        setAnswer(sg.key, sg.value, { onlyIfEmpty: true });
      }
      await Promise.all([
        refreshUploads().catch(() => undefined),
        loadLibrary().catch(() => undefined),
      ]);
    },
    // setAnswer is re-created every render by design (see its own note).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, id, refreshUploads, loadLibrary],
  );

  /**
   * Ask for a document to be read again.
   *
   * ⚠️ WORTH A BUTTON BECAUSE THE READ IS FAIL-SOFT. A timeout or a busy model
   * returns nothing and the row goes amber saying we could not read the
   * document — indistinguishable, to the person who took the photograph, from
   * "your photograph is no good". A live proof of address read perfectly on
   * the second attempt.
   */
  const rereadOneUpload = async (uploadId: string) => {
    try {
      const res = await motivationsApi.rereadUpload(token, id, uploadId);
      await refreshUploads();
      if (!res.ok && res.readable) {
        setUploadErr(
          'Still nothing readable on that one. Check the whole page is in shot, or replace it.',
        );
      } else {
        setUploadErr(null);
      }
    } catch (e) {
      setUploadErr(
        e instanceof MotivationApiError
          ? e.message
          : 'We could not read that again just now.',
      );
    }
  };

  const removeOneUpload = async (uploadId: string) => {
    await motivationsApi.removeUpload(token, id, uploadId);
    setUploads((u) => u.filter((x) => x.id !== uploadId));
    motivationsApi
      .uploads(token, id)
      .then((up) => {
        setDocuments(up.documents);
        setUploadKinds(up.kinds ?? []);
      })
      .catch(() => undefined);
  };

  const setAnswer = (
    key: string,
    value: string,
    opts: { onlyIfEmpty?: boolean } = {},
  ) => {
    dirty.current = true;
    if (key === 'firearm_calibre' || /^existing_firearm_\d+_calibre$/.test(key)) {
      overlapDirty.current = true;
    }
    setAnswers((a) => {
      // ⚠️ CHECKED INSIDE THE UPDATER, against the state React is actually
      // holding. Reading `answers` from the enclosing render and deciding out
      // here would race a document that fills several boxes at once: each
      // call would see the same stale snapshot.
      if (opts.onlyIfEmpty && (a[key] ?? '').trim()) return a;
      return { ...a, [key]: value };
    });
  };

  /**
   * A dropdown that fills in another box.
   *
   * ⚠️ IT SEEDS, IT NEVER CLOBBERS. The target is the paragraph the applicant
   * signs their name under. So: fill it when it is empty, and replace it only
   * when it still holds — character for character — the text WE put there for
   * the previously chosen option. The moment they edit a word of it, it is
   * theirs and a later change of discipline leaves it alone and offers a
   * button instead.
   */
  const seeded = useRef<Record<string, string>>({});
  const [prefillOffer, setPrefillOffer] = useState<{
    key: string;
    label: string;
    text: string;
  } | null>(null);

  // A plain function, not useCallback: setAnswer is re-created every render
  // anyway, and this needs to read the CURRENT answers to decide whether the
  // target box is still ours to fill.
  const pickOption = (field: MotivationField, value: string) => {
    setAnswer(field.key, value);
    const target = field.prefills;
    if (!target) return;
    const text = (field.prefillText?.[value] ?? '').trim();
    if (!text) return;

    const current = (answers[target] ?? '').trim();
    const ours = (seeded.current[target] ?? '').trim();
    const label =
      field.optionGroups
        ?.flatMap((g) => g.options)
        .find((o) => o.value === value)?.label ?? value;

    if (current === '' || current === ours) {
      seeded.current[target] = text;
      setAnswer(target, text);
      return;
    }
    // They have written their own. Offer, do not take.
    setPrefillOffer({ key: target, label, text });
  };


  /**
   * Pick a generation back up after the page has gone away.
   *
   * ⚠️ THE WORK NOW OUTLIVES THE REQUEST THAT STARTED IT, which is the whole
   * point — but it also means an applicant can reload, lose their phone
   * signal, or simply come back later and find a row that says GENERATING
   * with nothing watching it. Without this they would sit on a stale page
   * indefinitely while the finished document sat in the database.
   */
  useEffect(() => {
    if (detail?.status !== 'GENERATING') return;
    let alive = true;
    const deadline = Date.now() + 6 * 60 * 1000;
    void (async () => {
      while (alive && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!alive) return;
        try {
          const d = await motivationsApi.get(token, id);
          if (!alive) return;
          if (d.status !== 'GENERATING') {
            setDetail(d);
            setMessages(await motivationsApi.messages(token, id));
            return;
          }
        } catch {
          // A dropped poll is not a failed generation. Keep watching.
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [detail?.status, token, id]);

  const shown = useMemo(() => visibleFields(fields, answers), [fields, answers]);

  /**
   * A field key as the applicant knows it.
   *
   * Falling back to the raw key is deliberate: "discipline" on screen is
   * unhelpful but recognisable, whereas dropping the name entirely leaves an
   * error that names nothing at all.
   */
  const labelFor = useCallback(
    (k: string) => fields.find((f) => f.key === k)?.label ?? k,
    [fields],
  );

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

  /**
   * Same shape for associations. Several is the normal case — the
   * professional motivations list three — but the SINGLE-body applicant must
   * never see two empty blocks demanding names and numbers they do not have.
   * Rows appear when filled (a returning applicant, a vault fill) or when
   * asked for; a row counts as started once its name is in.
   */
  const assocRowsFilled = useMemo(() => {
    let n = 1;
    for (let i = 2; i <= 3; i++) {
      if ((answers[`association_${i}_name`] ?? '').trim()) n = i;
    }
    return n;
  }, [answers]);
  const [assocRowsShown, setAssocRowsShown] = useState(1);
  const assocRows = Math.max(assocRowsFilled, assocRowsShown);

  /**
   * Fields that ALREADY had a value when this application loaded — read off a
   * document or carried from the All Outdoor profile.
   *
   * ⚠️ CAPTURED ONCE, AND THAT IS THE WHOLE POINT. Deciding this from the
   * live answers meant a field locked itself the moment it held a character,
   * so typing into an empty box made the box disappear mid-word. Only what we
   * supplied is ever locked; anything typed in this session stays a normal
   * input, always.
   */
  const prefilled = useRef<Set<string> | null>(null);
  if (prefilled.current === null && fields.length && detail) {
    prefilled.current = new Set(
      fields
        .filter((f) => f.docSourced && (answers[f.key] ?? '').trim())
        .map((f) => f.key),
    );
  }
  // Unlocked by the pen. Once open it STAYS open — re-locking a field someone
  // is editing is the same interruption in a different costume.
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  // The "add a firearm licence" uploader in the owned-firearms section.
  const [licenceBusy, setLicenceBusy] = useState(false);
  const [licenceErr, setLicenceErr] = useState<string | null>(null);
  // Which requirement row is mid-upload. One at a time: the rows are small and
  // a spinner on the wrong one is worse than no spinner.
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const ownedRows = Math.max(1, ownedRowsFilled, ownedRowsShown);

  const { sections } = useMemo(() => {
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
      if (m) return Number(m[1]) <= ownedRows;
      const a = /^association_(\d)_/.exec(f.key);
      return !a || Number(a[1]) <= assocRows;
    });
    return { sections: groupBySection(visible) };
  }, [shown, ownedRows, assocRows, detail?.overlap?.needsJustification]);
  /**
   * What is still unanswered, RIGHT NOW.
   *
   * ⚠️ THE SERVER'S LIST IS A SNAPSHOT, and it is only as fresh as the last
   * round trip. `detail.missingRequired` was computed when the page loaded,
   * so a section the member had just filled in went on counting those fields
   * as outstanding and sat amber with everything in it answered — MO000017,
   * "the experience stays amber after filling it in". Answers typed since
   * then are the newer fact, so a field counts as outstanding only if the
   * server said so AND it is still empty on screen.
   *
   * The server list stays the source of WHICH fields are required — that is
   * registry logic and depends on answers this component does not evaluate.
   * All that happens here is crossing off the ones already filled.
   */
  const serverOutstanding = detail?.missingRequired ?? [];
  const outstanding = useMemo(() => {
    const empty = (k: string) => !(answers[k] ?? '').trim();
    // ⚠️ THE SNAPSHOT CAN ONLY SHRINK, AND THAT LOCKED SOMEBODY OUT.
    //
    // requiredKeys() on the server is answer-DEPENDENT: it filters the
    // registry through isVisible(), so answering "Married" makes
    // spouse_id_type and spouse_id_number required by fields that were not
    // required — and not even visible — when the page loaded. Crossing items
    // off a load-time list can never add those. The wizard therefore showed
    // nothing outstanding, enabled Generate, and the server refused with
    // "Some required answers are still missing".
    //
    // Generate is capped at a few calls an hour because a real one spends
    // money on a flagship model. A refusal spends nothing but is charged the
    // same, so three doomed clicks bought an hour of ThrottlerException.
    //
    // So the live registry is asked directly. `sections` is already
    // visibleFields() — the same predicate as the server's isVisible — so
    // anything required and empty in it is genuinely required and empty now.
    const live = sections
      .flatMap((s) => s.fields)
      .filter((f) => f.required && empty(f.key))
      .map((f) => f.key);
    // UNION, not replacement. `sections` also drops rows the wizard chooses
    // not to render yet (firearms beyond the first, the overlap question), and
    // the server may require something on registry logic this component does
    // not evaluate. Over-reporting shows a field to fill; under-reporting is
    // the dead end above.
    return Array.from(new Set([...serverOutstanding.filter(empty), ...live]));
  }, [serverOutstanding, answers, sections]);
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
    // STARTED, NOT FINISHED. Operator, 2026-08-19: a section with something in
    // it and something outstanding should read amber, not the same dim grey as
    // one nobody has opened.
    if (answered > 0) return 'partial';
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
            refused.length === 0 &&
            'We could not save just now — your answers are kept on this device and will save again shortly.'}
        </p>
        {refused.length > 0 && (
          // Louder than the status line, because this one does not fix itself
          // by waiting: the answer will not save until we ship a change.
          <p
            className="mt-2 rounded border p-2 text-xs"
            style={{
              borderColor: 'var(--red)',
              color: 'var(--red)',
            }}
            role="alert"
          >
            We could not store your answer to{' '}
            {refused.map((k) => labelFor(k)).join(', ')}. This is a fault on
            our side, not something you typed wrong — please tell support and
            quote reference {detail.referenceNumber}.
          </p>
        )}
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
        {/* ⚠️ A SECTION 16 PACK REPEATS ITSELF. The dedicated status and the
            letter of good standing describe the PERSON, not the firearm, so
            the ones from the last application are still the right documents —
            provided the letter has not gone stale, which the server checks
            before it offers them. The endorsement is deliberately never here:
            it names one firearm, so a previous one describes the wrong gun. */}
        {suggested.length > 0 && !suggestDone && (
          <div className="mt-3 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3">
            <p className="text-sm font-medium">
              You already have {suggested.length === 1 ? 'one' : suggested.length}{' '}
              of these
            </p>
            <ul className="mt-1 text-xs text-[var(--text-secondary)]">
              {suggested.map((sg) => (
                <li key={`${sg.source}:${sg.sourceId}`}>
                  {sg.title} — added {sg.addedOn}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded bg-[var(--red)] px-3 py-1.5 text-sm text-white hover:bg-[var(--red-hover)]"
                onClick={async () => {
                  setSuggestDone(true);
                  for (const sg of suggested) {
                    await attachFromLibrary(sg).catch(() => undefined);
                  }
                }}
              >
                Attach {suggested.length === 1 ? 'it' : 'them'}
              </button>
              <button
                type="button"
                className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
                onClick={() => setSuggestDone(true)}
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {documents && documents.needs.length > 0 && (
          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
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

            <DocumentChecklist
              rows={checklistRows}
              selected={pickedKind}
              onSelect={setPickedKind}
              onView={viewUpload}
              onRemove={removeOneUpload}
              onReread={rereadOneUpload}
              renderControls={(r) => {
                const k = uploadKindFor(r);
                const take = async (files: File[]) => {
                  const file = files[0];
                  if (!file) return;
                  setBusyKind(k);
                  setUploadErr(null);
                  try {
                    await addOneUpload(k, file);
                  } catch (ex) {
                    setUploadErr(
                      ex instanceof MotivationApiError
                        ? ex.message
                        : 'That upload did not work.',
                    );
                  } finally {
                    setBusyKind(null);
                  }
                };
                return (
                  <>
                    <LibraryPicker
                      items={library.filter((l) => l.kind === k)}
                      onPick={attachFromLibrary}
                    />
                    <ScanButton
                      compact
                      shape={shapeForKind(k)}
                      title={r.label}
                      kind={k}
                      handoff={{ dest: 'motivation', motivationId: id }}
                      onHandoffArrived={() => void refreshUploads()}
                      disabled={busyKind !== null}
                      label="Photograph it"
                      onFiles={take}
                      fallback={
                        <FilePickerButton
                          compact
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          disabled={busyKind !== null}
                          aria-label={`Upload ${r.label}`}
                          title="Upload a file"
                          onFiles={take}
                        />
                      }
                    />
                    {uploadErr && (
                      <span className="text-xs text-[var(--red)]">
                        {uploadErr}
                      </span>
                    )}
                  </>
                );
              }}
            />
          </div>
        )}

        <UploadPanel
          uploads={uploads}
          kinds={uploadKinds}
          motivationId={id}
          onHandoffArrived={refreshUploads}
          onRefile={async (uploadId, nextKind) => {
            await motivationsApi.refileUpload(token, id, uploadId, nextKind);
            const up = await motivationsApi.uploads(token, id);
            setUploads(up.files);
            setDocuments(up.documents);
            setUploadKinds(up.kinds ?? []);
          }}
          onAdd={addOneUpload}
          onRemove={removeOneUpload}
          onView={viewUpload}
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
              {/* WHAT THEY HAVE ALREADY TOLD US. Only in the two sections the
                  vault can actually answer: the competency number lives in
                  "About you", and the firearms already licensed to them live
                  in their own section. Anywhere else it would be noise. */}
              {(isOwned ||
                sec.section === 'About you' ||
                // ⚠️ THE DEDICATED-STATUS HALF NEVER RENDERED. The panel was
                // mounted on "About you" and handed the key prefix
                // `association_` — but those fields live in their own
                // "Dedicated status" section and always have, so the offer
                // computed the values, shipped them to the browser, and
                // filtered every one of them out against a section that could
                // not contain them. Silent since the day it was written.
                sec.section === 'Dedicated status') && (
                <LicenceCentreOfferPanel
                  token={token}
                  motivationId={id}
                  keyPrefixes={
                    isOwned
                      ? ['existing_firearm_']
                      : sec.section === 'Dedicated status'
                        ? ['association_']
                        : ['competency_number']
                  }
                  onApplied={(filled, missing) => {
                    // The applicant's own edits win over what arrives, the
                    // same way the profile prefill does above.
                    setAnswers((cur) => ({ ...filled, ...cur }));
                    setDetail((d) =>
                      d ? { ...d, missingRequired: missing } : d,
                    );
                    // A vault row that filled row 2 has to be visible, or the
                    // answer is saved into a box nobody can see.
                    const rows = [1, 2, 3, 4, 5, 6].filter((r) =>
                      Object.keys(filled).some(
                        (k) =>
                          k.startsWith(`existing_firearm_${r}_`) &&
                          (filled[k] ?? '').trim(),
                      ),
                    );
                    if (rows.length) {
                      setOwnedRowsShown((cur) =>
                        Math.max(cur, Math.max(...rows)),
                      );
                    }
                  }}
                />
              )}

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
                <div key={`${f.key}-w`}>
                {/* WE ASK BEFORE REPLACING. The applicant has written their
                    own words in this box, so a new discipline choice offers
                    its rules rather than overwriting them. */}
                {prefillOffer?.key === f.key && (
                  <div className="mb-2 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3 text-sm">
                    <p>
                      You have written your own answer here. Replace it with the
                      published rules for {prefillOffer.label}?
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded bg-[var(--red)] px-3 py-1.5 text-sm text-white hover:bg-[var(--red-hover)]"
                        onClick={() => {
                          seeded.current[prefillOffer.key] = prefillOffer.text;
                          setAnswer(prefillOffer.key, prefillOffer.text);
                          setPrefillOffer(null);
                        }}
                      >
                        Replace it
                      </button>
                      <button
                        type="button"
                        className="rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg-card-hover)]"
                        onClick={() => setPrefillOffer(null)}
                      >
                        Keep what I wrote
                      </button>
                    </div>
                  </div>
                )}
                <FieldInput
                  key={f.key}
                  field={f}
                  value={answers[f.key] ?? ''}
                  missing={outstanding.includes(f.key)}
                  locked={
                    (prefilled.current?.has(f.key) ?? false) &&
                    !unlocked.has(f.key)
                  }
                  onUnlock={() =>
                    setUnlocked((u) => new Set(u).add(f.key))
                  }
                  onChange={(v) => setAnswer(f.key, v)}
                  onPick={pickOption}
                />
                {/* ⚠️ THE PICKER SITS UNDER THE FIELD IT FILLS, not up in the
                    offer panel. The panel is a single "fill everything"
                    button; this is the answer to "I have two of those, which
                    one?" — and the only place that question makes sense is
                    beside the box it is about. */}
                {/* ⚠️ THE PICKERS ARE GONE FROM HERE, and the documents fill
                    these boxes instead. A camera, a file picker and a
                    dropdown hanging under two questions duplicated the
                    checklist below — the same three controls, for the same
                    two documents, in a second place — and the operator's word
                    for the result was cluttered. Attach the competency
                    certificate in the documents section and this fills
                    itself; see the note on applying suggestions in
                    addOneUpload. */}
                </div>
              ))}

              {/* ADD A LICENCE FROM HERE. The applicant is looking at six
                  empty boxes per firearm; the licence card in their hand
                  answers all six. It goes up as a CURRENT_LICENCE, which the
                  extraction already knows how to read into these fields, and
                  it lands in the pack as an annexure at the same time. */}
              {isOwned && (
                <div className="rounded border border-[var(--border)] bg-[var(--bg-inset)] p-3">
                  <p className="text-sm font-medium">
                    Photograph a licence instead of typing it
                  </p>
                  <p className="mb-2 mt-1 text-xs text-[var(--text-secondary)]">
                    We read the make, calibre and serials off it and fill the
                    boxes in. It is attached to your pack as well.
                  </p>
                  <FilePickerButton
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    multiple
                    disabled={licenceBusy}
                    onFiles={async (files) => {
                      setLicenceBusy(true);
                      setLicenceErr(null);
                      let added = 0;
                      for (const file of files) {
                        try {
                          await motivationsApi.addUpload(
                            token,
                            id,
                            'CURRENT_LICENCE',
                            file,
                          );
                          added++;
                        } catch (ex) {
                          setLicenceErr(
                            ex instanceof MotivationApiError
                              ? ex.message
                              : 'That upload did not work.',
                          );
                        }
                      }
                      if (added) {
                        // Re-read rather than merge by hand: the suggestions
                        // the extraction produced live on the application.
                        const d = await motivationsApi.get(token, id);
                        setAnswers((cur) => ({ ...d.answers, ...cur }));
                        setDetail(d);
                      }
                      setLicenceBusy(false);
                    }}
                  >
                    {licenceBusy ? 'Reading…' : 'Add a firearm licence'}
                  </FilePickerButton>
                  {licenceErr && (
                    <p className="mt-2 text-sm text-[var(--red)]">
                      {licenceErr}
                    </p>
                  )}
                </div>
              )}

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
              {sec.section === 'Dedicated status' && assocRows < 3 && (
                <label className="flex items-center gap-2 pt-2 text-sm">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => setAssocRowsShown(assocRows + 1)}
                  />
                  <span>I belong to another association as well</span>
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

      {/* ── The template ────────────────────────────────────────
          Placed BEFORE the declaration rather than after the download, so it
          is a choice made while they are still building rather than a setting
          discovered afterwards. It stays live once the document exists — the
          PDF is re-rendered from stored text on every download, so changing
          the colour of a finished pack costs one query and no rewrite. */}
      {catalogue && (
        <section className="mt-6 rounded border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <MotivationTemplatePicker
            catalogue={catalogue}
            format={template.format}
            colourway={template.colourway}
            // Defaults to marked when the server did not say. Erring the other
            // way would show a clean preview of a document that arrives
            // stamped, which is selling something we do not hand over.
            watermarked={detail.watermarked !== false}
            onChange={chooseTemplate}
            saving={templateSaving}
            error={templateError}
          />
        </section>
      )}

      {/* 5 — declaration and generate */}
      <section className="mt-6 rounded border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <h2 className="font-medium">Before we prepare it</h2>
        {detail.status === 'GENERATING' ? (
          // Offering "Prepare my motivation" here would earn a 409 from the
          // compare-and-swap and read as a broken button.
          <p className="mt-2 text-sm" role="status">
            We are writing it now — this takes about a minute. You can leave
            this page; it will be here when you come back.
          </p>
        ) : outstanding.length > 0 ? (
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
                  // Returns as soon as the work is CLAIMED, not finished.
                  await motivationsApi.generate(token, id);

                  // ⚠️ THE DOCUMENT IS WRITTEN AFTER THE RESPONSE, so the row
                  // is what to watch. Waiting on the request itself is what
                  // produced "Something went wrong" for a generation that had
                  // completed: about ninety seconds of work behind a sixty
                  // second proxy timeout, under a Cloudflare edge that gives
                  // up at a hundred regardless.
                  //
                  // Six minutes is far longer than a real run and exists only
                  // so this cannot spin forever. Nothing is lost by giving up
                  // early anyway — the work continues on the server, and the
                  // status is on the page whenever they come back to it.
                  const deadline = Date.now() + 6 * 60 * 1000;
                  let d = await motivationsApi.get(token, id);
                  while (d.status === 'GENERATING' && Date.now() < deadline) {
                    await new Promise((r) => setTimeout(r, 3000));
                    d = await motivationsApi.get(token, id);
                  }
                  setDetail(d);
                  setMessages(await motivationsApi.messages(token, id));
                  if (d.status === 'COMPLETED') router.refresh();
                  if (d.status === 'GENERATING') {
                    setError(
                      'This is taking longer than usual. It is still being written — leave this page open, or come back shortly and it will be here.',
                    );
                  }
                } catch (e) {
                  // ⚠️ NAME THE FIELDS, AND GO TO THEM. "Some required answers
                  // are still missing" on its own is a dead end — the member
                  // is looking at a form where everything visible is filled
                  // in. The server has always sent the list; nothing read it.
                  if (
                    e instanceof MotivationApiError &&
                    e.missing?.length
                  ) {
                    const labels = e.missing.map(labelFor);
                    setError(
                      `Still needed before we can write it: ${labels.join(', ')}.`,
                    );
                    // Re-read first: a required field can be missing BECAUSE
                    // the server sees an answer this page does not, and the
                    // fresh detail is what makes the step count honest.
                    await motivationsApi
                      .get(token, id)
                      .then(setDetail)
                      .catch(() => undefined);
                    const first = sections.findIndex((sec) =>
                      sec.fields.some((f) => e.missing!.includes(f.key)),
                    );
                    if (first >= 0) go(first + 2);
                  } else {
                    setError(
                      e instanceof MotivationApiError
                        ? e.message
                        : 'We could not prepare the document just now.',
                    );
                  }
                } finally {
                  setGenerating(false);
                }
              }}
            >
              {generating
                ? 'Writing it — about a minute…'
                : 'Prepare my motivation'}
            </button>
          </>
        )}

        {/* ⚠️ READABLE EVEN WHEN IT DID NOT PASS. A draft held back for more
            detail used to be invisible — the applicant paid for it, it was
            written, and all they saw was a score and a list of questions.
            Nobody can tell a fair knock-back from an over-strict one without
            reading the text. The PDF stays behind COMPLETED; this is the
            reading copy. */}
        {detail.hasDocument && detail.status !== 'COMPLETED' && (
          <div className="mt-4">
            <button
              type="button"
              className="rounded border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card-hover)]"
              onClick={async () => {
                if (draft) return setDraft(null);
                try {
                  setDraft(await motivationsApi.draft(token, id));
                } catch {
                  setError('We could not open the draft just now.');
                }
              }}
            >
              {draft ? 'Hide the draft' : 'Read the draft as written'}
            </button>
            {draft && (
              <div
                className="mt-3 rounded border border-[var(--border)] bg-[var(--bg-inset)] p-4"
                style={{ maxHeight: '28rem', overflowY: 'auto' }}
              >
                <p className="mb-3 text-xs text-[var(--text-tertiary-on-card)]">
                  This is a draft, not a document to file. It scored{' '}
                  {draft.qualityScore ?? '—'} and was held back for more
                  detail — the questions above are what it was marked down on.
                </p>
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {draft.text}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ⚠️ BUTTONS, NOT ANCHORS. These endpoints sit behind the Clerk
            guard, and an <a href> carries no Authorization header — "Open
            your motivation" was a guaranteed 401, found the first time a
            finished document existed. Same synchronous-tab + authed-blob
            pattern viewUpload uses, popup-blocked fallback included. */}
        {detail.status === 'COMPLETED' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card-hover)]"
              onClick={() =>
                openAuthedPdf(
                  () => motivationsApi.pdfBlobUrl(token, id),
                  `${detail.referenceNumber}-motivation.pdf`,
                )
              }
            >
              Open your motivation
            </button>
            {(answers[SAPS271_OPT_KEY] ?? '') === SAPS271_FILL && (
              <button
                type="button"
                className="rounded border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--bg-card-hover)]"
                onClick={() =>
                  openAuthedPdf(
                    () => motivationsApi.saps271BlobUrl(token, id),
                    `${detail.referenceNumber}-saps271.pdf`,
                  )
                }
              >
                Open your pre-filled SAPS 271
              </button>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-[var(--red)]">{error}</p>}
      </section>

      {/* Deleting was possible on the API from the start and had no way in
          from the wizard. It is a real erasure — the encrypted documents go
          with it — so it asks first and says what it is about to do. */}
      {/* THE PACK, not just the motivation. The list already existed on the
          server and nothing rendered it, while /motivations promised "a
          checklist of everything to take to the police station". */}
      {/* ⚠️ NOT WHILE THE FORM IS A DRAFT. Fourteen tickboxes about walking
          into a police station, sitting under a half-filled application, are
          a list of things to do about a document that does not exist yet —
          and they were rendered unconditionally from the day they were
          added.

          Two gates, because the operator asked for two: the motivation has to
          have been GENERATED, and he has to have said he has read it. The
          second is deliberately a plain acknowledgement rather than a status
          — nothing about the pack changes when he presses it, and pretending
          otherwise would put a fake approval step into an application. */}
      {detail.status === 'COMPLETED' && (
        <PackChecklistGate motivationId={id} token={token} />
      )}

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
  locked = false,
  onUnlock,
  onPick,
  onChange,
}: {
  field: MotivationField;
  value: string;
  missing: boolean;
  /** We filled this in. Shown, greyed, with a pen — never taken away. */
  locked?: boolean;
  onUnlock?: () => void;
  /** Choice fields that seed another field route through here instead. */
  onPick?: (field: MotivationField, value: string) => void;
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

      {/* WHAT WE FILLED IN FOR THEM.
          In place, in its own section, so nothing reflows — the value is
          visible and the pen opens it. POPIA needs it correctable; the
          operator needs it to stop moving while they type. */}
      {locked ? (
        <div className="mt-1 flex items-center gap-2">
          <div className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            {/* A date reads as a date even while locked. Pure formatting —
                an unparseable legacy value falls through to its raw text
                rather than being hidden behind a pretty one. */}
            {field.kind === 'date' && parseIso(value)
              ? formatLong(parseIso(value)!)
              : value}
          </div>
          <button
            type="button"
            onClick={onUnlock}
            aria-label={`Edit ${field.label}`}
            title="Edit"
            className="rounded border border-[var(--border)] px-2 py-2 text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
        </div>
      ) : (
        <>
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

      {/* DATES GET THE THREE-STEP PICKER. Split out of the short/date
          union because a date is no longer an <input> — and because this is
          the one field kind the backend never validates, so a control that
          can only ever emit a whole, real date is the only thing between the
          wizard and a half-typed answer being autosaved and then locked
          behind the edit pen on the next load. */}
      {field.kind === 'date' && (
        <DateField
          id={field.key}
          label={field.label}
          value={value}
          onChange={onChange}
          className={base}
          invalid={missing}
          focusYear={todayYmd().y + (field.focusOffsetYears ?? 0)}
          reach={field.reach ?? 'near'}
        />
      )}

      {field.kind === 'short' && (
        <input
          id={field.key}
          type="text"
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

      {(field.kind === 'choice' || field.kind === 'yesno') &&
        !field.optionGroups && (
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

      {/* A SERVED LIST — the shooting disciplines, grouped by family.
          A stored value we do not recognise is shown as its own option
          rather than silently reset: before this was a dropdown it was a
          text box, and somebody's typed answer is still their answer. */}
      {field.optionGroups && (
        <select
          id={field.key}
          className={base}
          value={value}
          onChange={(e) => onPick?.(field, e.target.value) ?? onChange(e.target.value)}
        >
          <option value="">Choose…</option>
          {value.trim() !== '' &&
            !field.optionGroups.some((g) =>
              g.options.some((o) => o.value === value),
            ) && (
              <option value={value}>{value} (what you typed before)</option>
            )}
          {field.optionGroups.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
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
        </>
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

/**
 * What is attached to one requirement.
 *
 * The point of the line is confirmation: the member should be able to look at
 * a requirement and see, without counting files, that something answers it and
 * which annexure it became.
 */
function AttachedTo({
  kind,
  uploads,
  onRemove,
  onView,
}: {
  kind: string;
  uploads: UploadRow[];
  onRemove: (id: string) => Promise<void>;
  onView: (id: string) => Promise<void>;
}) {
  const mine = uploads.filter((u) => u.kind === kind);
  if (!mine.length) {
    // The status said this requirement is met but no row carries the kind —
    // which happens for a moment after an upload, before the list re-reads.
    return (
      <span className="text-xs" style={{ color: 'var(--success)' }}>
        Attached
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      {mine.map((u) => (
        <span
          key={u.id}
          className="inline-flex items-center gap-2 rounded border px-2 py-1 text-xs"
          style={{
            borderColor: 'rgba(47,158,107,0.38)',
            background: 'rgba(47,158,107,0.10)',
            color: 'var(--text-primary)',
          }}
        >
          <span aria-hidden style={{ color: 'var(--success)' }}>
            ✓
          </span>
          <span>
            Attached
            {u.annexure ? ` \u00b7 Annexure ${u.annexure}` : ''}
            {u.available ? '' : ' \u00b7 no longer stored'}
          </span>
          {/* ⚠️ "ATTACHED" IS NOT PROOF. Every one of these went up as a
              photograph the member never saw again — and the whole point of
              the checklist is that a DFO will see it. Being able to open it
              is how somebody catches the shot of their thumb before SAPS
              does. Only offered while the file is still stored: after the
              retention purge the row remains as a record and the bytes are
              gone. */}
          {u.available && (
            <button
              type="button"
              className="underline"
              aria-label={`View ${u.label}`}
              onClick={() => void onView(u.id)}
            >
              View
            </button>
          )}
          <button
            type="button"
            className="underline"
            aria-label={`Remove ${u.label}`}
            onClick={() => void onRemove(u.id)}
          >
            Remove
          </button>
        </span>
      ))}
    </span>
  );
}

function UploadPanel({
  uploads,
  kinds,
  motivationId,
  onAdd,
  onRefile,
  onRemove,
  onView,
  onHandoffArrived,
}: {
  uploads: UploadRow[];
  kinds: PickableKind[];
  motivationId: string;
  onAdd: (kind: string, file: File) => Promise<AddedUpload | undefined>;
  onRefile: (uploadId: string, kind: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Open one document, so "attached" can be checked rather than believed. */
  onView: (id: string) => Promise<void>;
  /** Re-read the pack after a phone sent something straight to the server. */
  onHandoffArrived: () => Promise<void>;
}) {
  // Empty string until the list arrives, and the file input stays disabled
  // until then — posting an empty kind would 400 with nothing useful to show.
  /**
   * THE UPLOAD PATH, lifted out of the file input.
   *
   * Named rather than inline so every source of a File — the themed
   * picker, the per-requirement rows, and next the camera — feeds one
   * code path with one set of checks.
   */
  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    setFiled([]);
    setProgress({ done: 0, total: files.length });

    // ONE AT A TIME, deliberately. Each upload writes an encrypted
    // file and makes a vision call; firing eight at once would race the
    // per-minute limit and give no usable progress.
    const named: typeof filed = [];
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      try {
        // ⚠️ ALWAYS AUTO-NAMED HERE, one file or eight. This panel no longer
        // asks which document anything is — that question moved to the
        // checklist above, where the member answers it by choosing a line.
        // Anything arriving through this path is by definition unlabelled,
        // and the correction dropdown below catches what we get wrong.
        const added = await onAdd('', file);
        if (added?.autoFiled) {
          named.push({
            id: added.id,
            name: file.name,
            kind: added.kind,
            confident: added.confident === true,
          });
        }
      } catch (ex) {
        // One bad file must not abandon the rest of the pack.
        failed.push(
          `${file.name}: ${
            ex instanceof MotivationApiError
              ? ex.message
              : 'did not upload'
          }`,
        );
      }
      setProgress({ done: i + 1, total: files.length });
    }

    setFiled(named);
    setErr(failed.length ? failed.join(' · ') : null);
    setBusy(false);
    setProgress(null);
  }

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Per-file state while a pack is going up: "3 of 8 — competency…". */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  /** What the server named each auto-filed document, pending confirmation. */
  const [filed, setFiled] = useState<
    { id: string; name: string; kind: string; confident: boolean }[]
  >([]);

  return (
    <div className="mt-3">
      {/* ⚠️ THE DOCUMENT-TYPE SELECT IS GONE FROM HERE. The checklist above is
          now a radio list of exactly these kinds — so this was a second
          control answering a question the member had already answered, three
          inches higher, and the two could disagree. This panel does one
          thing: take the whole pack and work out what each file is. */}
      <div className="flex flex-wrap items-center gap-2">
        <ScanButton
          // Follows the picker above; A4 while nothing is chosen, because a
          // motivation pack is mostly paper.
          // A pack is mostly paper, and this panel never names one document.
          shape="a4"
          // ⚠️ THIS IS THE UPLOAD-ALL. Somebody opening it is holding a pack —
          // a competency certificate, a licence card, a page of an ID book —
          // and scanning exactly one thing is the unusual case here, not the
          // default. "Different document" between shots lets the aim box
          // change with each one.
          multiDefault
          title="Photograph a document"
          onFiles={uploadFiles}
          disabled={busy}
          label="Photograph documents"
          handoff={{ dest: 'motivation', motivationId }}
          onHandoffArrived={() => void onHandoffArrived()}
          fallback={
            <FilePickerButton
              accept="image/jpeg,image/png,image/webp,application/pdf"
              // A PACK GOES UP IN ONE GO. Picking one file at a time and
              // choosing a type for each is the slowest possible way to hand
              // over documents somebody already has sitting in a folder.
              multiple
              disabled={busy}
              variant="primary"
              onFiles={uploadFiles}
            >
              Upload all my documents
            </FilePickerButton>
          }
        />
      </div>
      <p className="mt-2 text-xs text-[var(--text-tertiary-on-card)]">
        Send the whole pack in one go and we read each document to work out
        what it is — no need to say which is which. We show you what we made of
        them afterwards, and one dropdown fixes anything we got wrong. JPG,
        PNG, WebP or PDF, up to 10 MB each. On an iPhone, choose the photos
        from your library rather than from Files.
      </p>

      {progress && (
        <p className="mt-2 text-sm" aria-live="polite">
          Uploading {progress.done + 1} of {progress.total}…
        </p>
      )}

      {/* WHAT WE FILED EACH DOCUMENT AS.
          Shown because the required-documents list counts the TYPE, not the
          contents — so a document filed wrongly would tick a requirement the
          pack does not actually meet. Correcting it is one dropdown. */}
      {filed.length > 0 && (
        <div className="mt-3 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3">
          <p className="text-sm font-medium">
            Here is what we made of them — change any that are wrong
          </p>
          <ul className="mt-2 space-y-2">
            {filed.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={f.name}>
                  {f.name}
                  {!f.confident && (
                    <span className="ml-2 text-xs text-[var(--warning)]">
                      not sure
                    </span>
                  )}
                </span>
                <select
                  className="rounded border border-[var(--border)] bg-[var(--bg-inset)] px-2 py-1 text-sm text-[var(--text-primary)] [&>option]:bg-[var(--bg-card)] [&>option]:text-[var(--text-primary)]"
                  value={f.kind}
                  aria-label={`Document type for ${f.name}`}
                  onChange={async (e) => {
                    const next = e.target.value;
                    setFiled((cur) =>
                      cur.map((x) =>
                        x.id === f.id ? { ...x, kind: next, confident: true } : x,
                      ),
                    );
                    await onRefile(f.id, next);
                  }}
                >
                  {kinds.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-2 text-xs underline"
            onClick={() => setFiled([])}
          >
            These are right
          </button>
        </div>
      )}
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
            <span className="flex shrink-0 items-center gap-3">
              {u.available && (
                <button
                  type="button"
                  className="text-xs underline"
                  aria-label={`View ${u.label}`}
                  onClick={() => void onView(u.id)}
                >
                  View
                </button>
              )}
              <button
                type="button"
                className="text-xs underline"
                aria-label={`Remove ${u.label}`}
                onClick={() => onRemove(u.id)}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
