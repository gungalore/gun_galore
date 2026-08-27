'use client';

import { useAuth } from '@clerk/nextjs';
import DateField from '@/components/date-field';
import FilePickerButton from '@/components/file-picker-button';
import ScanButton from '@/components/scan/scan-button';
import LibraryPicker from '@/components/library-picker';
import VaultConsentModal from '@/components/vault-consent';
import { licenceCentreApi } from '@/lib/licence-centre-api';
import DocumentChecklist, {
  ChecklistRow,
} from '@/components/document-checklist';
import { shapeForKind } from '@/lib/scan/shapes';
import LicenceCentreOfferPanel from '@/components/licence-centre-offer-panel';
import MotivationChecklistPanel from '@/components/motivation-checklist-panel';
import MotivationTemplatePicker from '@/components/motivation-template-picker';
import MotivationCoverPhoto from '@/components/motivation-cover-photo';
import MotivationWitnesses from '@/components/motivation-witnesses';
import MotivationSellerConsent from '@/components/motivation-seller-consent';
import { formatLong, parseIso, todayYmd } from '@/lib/date-picker-model';
import { useParams, useRouter } from 'next/navigation';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { StepStatus } from '@/components/step-accordion';
import MotivationStepRail from '@/components/motivation-step-rail';
import MotivationStepNav from '@/components/motivation-step-nav';
import { useShellStep } from '@/components/shell/shell-step';
import { StepRail } from '@/components/step-rail';
import {
  OWNED_SECTION,
  isRepeatingSection,
  nameKeyFor,
  slotOfKey,
  summaryKeysFor,
} from '@/lib/motivation-item-groups';
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
  type TemplateLayoutKey,
  type TemplateCatalogue,
  type TemplateFormat,
  groupBySection,
  motivationsApi,
  visibleFields,
} from '@/lib/motivations-api';
import { mergeReviewQueue } from '@/lib/document-review-rules';
import { useScrollToTop } from '@/components/shell/shell-scroll';
// Not motivationsApi's `request()` — lib/motivations-api.ts is a different
// file's territory in this same review, and its MotivationDetail does not
// yet type `label`. safeJson is a plain read-only helper, so importing it
// costs nothing and keeps the rename call's empty-204 handling consistent
// with every other request on this page.
import { safeJson } from '@/lib/safe-json';

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

// ────────────────────────────────────────────────────────────────────
// THE SIX STEPS.
//
// Operator, 2026-08-24: "a horizontal progress indicator style stepper... group
// the steps that follow each other", and "the uploads should do all the heavy
// lifting and the applicant has minimal fill-in work".
//
// ⚠️ A STEP IS A UNION OF WHOLE REGISTRY SECTIONS, NEVER PART OF ONE. Every
// showIf pair in the registry is intra-section, so keeping sections whole keeps
// all 38 of them inside one step no matter how the steps are ordered — a field
// can never be gated by an answer on a screen the applicant has not reached.
// It also means orderByDependency's within-a-section guarantee still holds, and
// no fieldKey→step map has to be maintained against 144 keys. Merging two
// sections into one step is free; cutting one across two steps is not.
//
// ⚠️ THE SAPS-271 OPT-IN SITS IN STEP 1, and that placement is load-bearing.
// It is the one gate that crosses sections: answering "fill it in for me"
// turns on ~48 formOnly fields spread through steps 2, 4 and 5. Asked first,
// the lean dealer path stays the default and the form only grows when somebody
// asks it to. Asked later, those fields would appear behind the applicant.
//
// Sections are matched BY NAME, which is what groupBySection buckets on. A
// section that is not named here still renders — see UNPLANNED_STEP — so a new
// registry section can never silently vanish from the form.
// ────────────────────────────────────────────────────────────────────

interface StepDef {
  key: string;
  /** On the rail. Short enough to sit under a 28px circle. */
  label: string;
  /** The heading inside the step body. */
  title: string;
  blurb?: string;
  /** Registry section names, in the order they should appear. */
  sections: string[];
}

const STEP_PLAN: StepDef[] = [
  {
    key: 'documents',
    label: 'Documents',
    title: 'Start with your documents',
    blurb:
      'This is the step that saves you the most typing — we read what we can off whatever you upload and fill the rest of the form in for you.',
    sections: ['The SAPS 271 form'],
  },
  {
    key: 'you',
    label: 'You & firearm',
    title: 'You and the firearm',
    sections: ['About you', 'The firearm'],
  },
  {
    key: 'owned',
    label: 'What you own',
    title: 'Firearms you already own',
    sections: ['Firearms you already own'],
  },
  {
    key: 'record',
    label: 'Storage & record',
    title: 'Storage and your record',
    sections: ['Storage and safety', 'History'],
  },
  {
    key: 'case',
    label: 'Your case',
    title: 'Your case',
    sections: [
      'Dedicated status',
      'Your circumstances',
      'Experience',
      'The existing licence',
    ],
  },
  { key: 'prepare', label: 'Prepare', title: 'Prepare your pack', sections: [] },
];

/**
 * Where an unrecognised section goes.
 *
 * ⚠️ NOT A TIDINESS DETAIL. If a section added to the registry tomorrow matched
 * no step it would render nowhere, and the server would still require its
 * fields — an applicant staring at "1 still to answer" with no box on screen
 * anywhere. Falling through to "Your case" is arbitrary but visible, which is
 * the only property that matters here.
 */
const UNPLANNED_STEP = STEP_PLAN.findIndex((s) => s.key === 'case');

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
 * ⚠️ THIS USED TO PICK BETWEEN THE SAFE'S THREE KINDS — it handed over the
 * first shot still missing, so pressing the button three times filled closed,
 * then half-open, then bolts. It could only ever be a guess about which
 * photograph the member was holding, and it is gone with the kinds it chose
 * between: every row, the safe included, is now simply its own kind. Kept as a
 * function because the call sites read better for it.
 */
function uploadKindFor(row: ChecklistRow | null): string {
  return row?.kind ?? '';
}

export default function MotivationWizardPage() {
  const { getToken, userId: clerkUserId } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  // Scrolls the live scroller to the top — `window` on the web, the shell
  // pane in the installed app. See components/shell/shell-scroll.tsx.
  const scrollToTop = useScrollToTop();

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
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  // 1-based step on screen. Was "which accordion is open"; it is now "which
  // step the rail is pointing at", and unlike the old accordion it is never 0 —
  // there is always a step showing.
  const [expanded, setExpanded] = useState(1);
  const [furthest, setFurthest] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [testimonialConsent, setTestimonialConsent] = useState(false);
  // Values read off uploaded documents, waiting to be confirmed. NOT answers.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // ── The member's own name for this application ───────────────────────
  //
  // Operator, board review 2026-08-27: "User must be able to rename the
  // motivation." A member may be running a Section 13 self-defence and two
  // Section 16 dedicated-hunter applications at once; without this they are
  // told apart only by section and date. Purely a label for their own list —
  // see motivations.service.ts#rename for why it never reaches the document.
  //
  // ⚠️ HELD SEPARATELY FROM `detail`, NOT FOLDED INTO ITS TYPE. MotivationDetail
  // in lib/motivations-api.ts does not yet declare `label` — that file belongs
  // to a different change in this same review, so this reads the field off the
  // wire response by hand rather than widening a shared type out from under it.
  const [label, setLabel] = useState<string | null>(null);
  // The section text ("Section 13 — Self-defence"), served by
  // motivationsApi.fields rather than duplicated here — see the load effect.
  // The fallback title when no label has been set.
  const [licenceLabel, setLicenceLabel] = useState('');
  const [renamingLabel, setRenamingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState('');
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

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
    layout: TemplateLayoutKey;
    // ⚠️ MUST MATCH THE RENDERER'S DEFAULT SCHEME. This is the value on screen
    // between mount and the catalogue arriving, so a stale one shows a colour
    // the document will not be in — and if the member never touches the picker,
    // it is the only colour they were ever shown.
  }>({ format: 'comprehensive', colourway: 'alloutdoor', layout: 'banner' });
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
        // `label` is on the wire (motivations.service.ts#findOne) but not on
        // MotivationDetail's declared type — see the state declaration above.
        setLabel((d as MotivationDetail & { label?: string | null }).label ?? null);
        setFields(fs.fields);
        setLicenceLabel(fs.label);
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

  // The mobile push header's title for THIS motivation, not the index's fixed
  // "Motivation Centre" — see lib/shell-routes.ts (only the exact '/motivations'
  // path keeps the mapped title now) and shell-header.tsx's PushHeader, which
  // takes whatever this sets as document.title and shows everything before the
  // first em dash.
  //
  // ⚠️ THE EM DASH IS NEUTRALISED, NOT CARRIED THROUGH. Both the section text
  // ("Section 13 — Self-defence") and a member's own typed name can contain
  // "—", and PushHeader's derived-title effect does a naive
  // `document.title.split('—')[0]`. Left alone, "Section 13 — Self-defence —
  // All Outdoor" would show as bare "Section 13" in the header. Swapping "—"
  // for a plain hyphen keeps every word without tripping that split.
  useEffect(() => {
    if (!detail) return;
    const name = (label && label.trim()) || licenceLabel || 'Motivation';
    document.title = `${name.replace(/—/g, '-')} — All Outdoor`;
  }, [detail, label, licenceLabel]);

  /**
   * The member's own name for this application, e.g. "Home defence" against a
   * Section 13 draft. Never an answer, never read into the document — see
   * motivations.service.ts#rename.
   *
   * ⚠️ A HAND-ROLLED FETCH, NOT motivationsApi — lib/motivations-api.ts is a
   * different file's territory in this same review. Mirrors that module's own
   * request() conventions (fresh token per call, safeJson on a body that is
   * empty on most days) so it fails the same way the rest of this page does.
   */
  const saveLabel = useCallback(
    async (raw: string) => {
      setLabelSaving(true);
      setLabelError(null);
      try {
        const API_URL =
          process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
        const tok = await token();
        const res = await fetch(`${API_URL}/motivations/${id}/label`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
          },
          body: JSON.stringify({ label: raw }),
        });
        if (!res.ok) {
          const body = await safeJson<{ message?: string | string[] }>(res, {});
          throw new MotivationApiError(
            Array.isArray(body.message)
              ? body.message.join(' ')
              : (body.message ?? 'We could not save that name.'),
            res.status,
          );
        }
        const saved = await safeJson<{ label: string | null }>(res, {
          label: null,
        });
        setLabel(saved.label);
        setRenamingLabel(false);
      } catch (e) {
        setLabelError(
          e instanceof MotivationApiError
            ? e.message
            : 'We could not save that name. Please try again.',
        );
      } finally {
        setLabelSaving(false);
      }
    },
    [id, token],
  );

  /**
   * Apply a template choice.
   *
   * ⚠️ SENDS ONLY WHAT CHANGED. Spreading the whole selection would mean a
   * colour tap also rewrites the format, and two quick taps on different
   * controls would race with one another's stale copy — the second request
   * carrying the first's pre-click format and undoing it.
   */
  const chooseTemplate = useCallback(
    async (choice: {
      format?: TemplateFormat;
      colourway?: Colourway;
      layout?: TemplateLayoutKey;
    }) => {
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
        setAnswer(sg.key, sg.value, {
          onlyIfEmpty: true,
          fromDocument: true,
        });
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
  /**
   * Are we keeping this member's documents?
   *
   * ⚠️ IT DRIVES A CONTROL, NOT A GATE. The picker says "nothing saved to
   * reuse yet" when the library is empty, and that sentence is untrue for
   * somebody holding twelve documents who told us not to offer them. This is
   * what lets it say the other thing.
   *
   * Undefined until the call lands — the picker only takes the third branch on
   * an explicit false, so a slow call shows the ordinary control rather than
   * flashing "turn it on" at somebody who already has.
   */
  const [keeping, setKeeping] = useState<boolean | undefined>(undefined);
  const [askConsent, setAskConsent] = useState(false);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);

  const loadLibrary = useCallback(async () => {
    try {
      const r = await motivationsApi.library(token, id);
      setLibrary(r.items);
      setSuggested(r.suggested ?? []);
    } catch {
      // A library we cannot read costs a shortcut, not the ability to upload.
    }
    try {
      const c = await licenceCentreApi.consent(token);
      setKeeping(c.keeping);
      setRetentionDays(c.retentionDays ?? null);
    } catch {
      // Same rule: a failed lookup costs the extra control, not the page.
    }
  }, [token, id]);
  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  /**
   * Attach what the member already holds, once.
   *
   * Operator: "why can't the server add the relevant documents in place and
   * mark them green for me?"
   *
   * ⚠️ ONCE PER MOUNT, GUARDED BY A REF, AND THAT GUARD IS LOAD-BEARING. This
   * is a POST that writes to the application. The effect's deps are stable,
   * but a ref costs nothing and the failure it prevents is bad: React 18
   * StrictMode double-invokes effects in development, and any future dep
   * change would turn "attach my documents" into "attach my documents again,
   * on every render". The server skips a kind already attached, so a repeat is
   * harmless — but relying on the server to be idempotent for correctness of
   * the CLIENT is how the client stops being careful.
   */
  const autolinkRan = useRef(false);
  useEffect(() => {
    if (autolinkRan.current) return;
    autolinkRan.current = true;
    void (async () => {
      try {
        const res = await motivationsApi.autolink(token, id);
        if (!res.attached.length) return;
        setAutolinked(res.attached);
        // Everything downstream reads from these, so refresh rather than
        // patching the lists by hand and risking a disagreement.
        const up = await motivationsApi.uploads(token, id);
        setUploads(up.files);
        setDocuments(up.documents);
        setUploadKinds(up.kinds ?? []);
      } catch {
        // Never costs the page. The member attaches by hand, as before.
      }
    })();
  }, [token, id]);
  const [autolinked, setAutolinked] = useState<
    { kind: string; title: string }[]
  >([]);

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
      // One row, one kind — including the safe, since 2026-08-23. Several
      // photographs land under the same kind and all of them list here.
      files: uploads.filter((u) => u.kind === n.kind),
      reusable: library.filter((l) => l.kind === n.kind),
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
    async (item: LibraryItem, placeConfirmed = false) => {
      const row = await motivationsApi.addFromLibrary(
        token,
        id,
        item.source,
        item.sourceId,
        placeConfirmed,
      );
      setUploads((u) => [...u, row]);
      // ⚠️ NEVER OVER AN ANSWER THEY TYPED. Unlike the per-field camera —
      // where pressing "photograph my competency certificate" IS the request
      // to replace what is in that box — this attaches a whole document and
      // may carry half a dozen values with it. Overwriting on that basis
      // would quietly undo work they did by hand.
      for (const sg of row.suggestions ?? []) {
        setAnswer(sg.key, sg.value, {
          onlyIfEmpty: true,
          fromDocument: true,
        });
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

  /**
   * Attach evidence straight onto the question it supports.
   *
   * ⚠️ THE SAME UPLOAD KIND THE CHECKLIST USES, deliberately. A file attached
   * to the hunting record IS the shooting activity log — it satisfies the
   * step-1 row, gets an annexure letter and prints in the pack, exactly as one
   * attached four steps away would. Giving these their own private kind would
   * have produced two lists of the same documents that could disagree, and a
   * DFO reading a pack that lists an annexure twice.
   *
   * ⚠️ AND NO EXTRACTION RUNS ON THEM. A target or a register page answers no
   * registry field; SHOOTING_ACTIVITY_LOG is not in EXTRACTABLE, so addUpload
   * stores the bytes and proposes nothing. That is the difference between a
   * document that ANSWERS a question and one that SUPPORTS an answer.
   */
  const attachToField = async (kind: string, files: File[]) => {
    if (!files.length) return;
    setBusyKind(kind);
    setUploadErr(null);
    try {
      // ⚠️ SEQUENTIAL, NOT Promise.all — the same reason the checklist does it
      // sequentially: each upload counts existing rows against the cap and
      // writes a new one, so firing them together lets several see the same
      // count and slip past it.
      for (const file of files) {
        await addOneUpload(kind, file);
      }
    } catch (err) {
      setUploadErr(
        err instanceof Error ? err.message : 'That would not upload.',
      );
    } finally {
      setBusyKind(null);
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
    opts: { onlyIfEmpty?: boolean; fromDocument?: boolean } = {},
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
      // ⚠️ MARKED HERE, INSIDE THE UPDATER, FOR THE SAME REASON THE CHECK IS
      // HERE — this is the only place that knows the write ACTUALLY HAPPENED.
      //
      // A document filling an empty box makes that value doc-sourced, so it
      // should read the way every other doc-sourced value does: greyed, with
      // the edit pen. Deciding it outside would race the same stale snapshot,
      // and marking a key whose write was skipped would grey out — and lock —
      // an answer the applicant typed themselves. That is the failure this
      // placement rules out rather than guards against.
      if (opts.fromDocument && prefilled.current) prefilled.current.add(key);
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
   * The same, for a field where several options can be chosen at once.
   *
   * ⚠️ THE PREFILL IS THE WHOLE POINT OF MULTI-SELECT HERE. A section 16
   * motivation argues that the firearm suits the discipline, so an applicant
   * who shoots three has three arguments to make — and what each body's rules
   * require of the firearm is exactly the part they cannot write from memory.
   * Composing one paragraph per discipline, each under its own name, is worth
   * more than the list of names on its own.
   */
  const pickMulti = (field: MotivationField, values: string[]) => {
    const joined = values.join(', ');
    setAnswer(field.key, joined);

    const target = field.prefills;
    if (!target) return;

    const labelFor = (v: string) =>
      field.optionGroups?.flatMap((g) => g.options).find((o) => o.value === v)
        ?.label ?? v;

    const text = values
      .map((v) => {
        const body = (field.prefillText?.[v] ?? '').trim();
        return body ? `${labelFor(v)}: ${body}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
    if (!text) return;

    const current = (answers[target] ?? '').trim();
    const ours = (seeded.current[target] ?? '').trim();

    // Untouched, or still exactly what we last seeded — safe to rewrite as the
    // selection changes. Once they have edited it, it is theirs.
    if (current === '' || current === ours) {
      seeded.current[target] = text;
      setAnswer(target, text);
      return;
    }
    setPrefillOffer({
      key: target,
      label: values.map(labelFor).join(' + '),
      text,
    });
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

  /**
   * How many rows have EVER been on screen this session. Only ever rises.
   *
   * ⚠️ WITHOUT THIS, EMPTYING A GATING BOX DELETES ITS WHOLE PANEL MID-EDIT.
   * `ownedRowsFilled` is recomputed from live answers on every keystroke, and
   * a row that exists only because it was filled disappears the instant its
   * calibre goes empty — the section filter drops every field of that row, and
   * React unmounts the disclosure the applicant is standing in. Select-all and
   * retype in the Calibre box of firearm 2 and make, type, serials and use all
   * vanish from under the cursor. Associations key on the name, which is the
   * panel's own title, so it is worse there.
   *
   * The same class of bug as the open/shut latch and the prefilled capture: a
   * default worked out from a live value, applied while somebody is typing
   * into that value. Once a row has been seen it stays; an emptied one prints
   * blank and can be filled in again, which is what the copy already promises.
   */
  const ownedHigh = useRef(1);
  ownedHigh.current = Math.max(ownedHigh.current, ownedRowsFilled, ownedRowsShown);
  const assocHigh = useRef(1);
  assocHigh.current = Math.max(assocHigh.current, assocRowsFilled, assocRowsShown);
  const assocRows = Math.max(1, assocHigh.current);

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
  const ownedRows = Math.max(1, ownedHigh.current);

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
  /**
   * The registry sections that belong to each step, in plan order.
   *
   * Built from the LIVE `sections` list, so a step whose sections do not exist
   * for this licence type simply comes out empty — S24 has no "Dedicated
   * status", S13 no "Experience" — and empty content steps are dropped from
   * the rail below rather than shown as a dead end.
   */
  const stepSections = useMemo(() => {
    const byStep: (typeof sections)[] = STEP_PLAN.map(() => []);
    for (const sec of sections) {
      const idx = STEP_PLAN.findIndex((s) => s.sections.includes(sec.section));
      byStep[idx >= 0 ? idx : UNPLANNED_STEP].push(sec);
    }
    return byStep;
  }, [sections]);

  /**
   * The steps actually shown, and their numbers.
   *
   * Steps 1 (documents) and the last (prepare) always exist — they carry
   * uploads and Generate, not registry fields — so they are kept even when
   * they hold no sections.
   */
  const steps = useMemo(
    () =>
      STEP_PLAN.map((def, i) => ({ def, sections: stepSections[i], index: i }))
        .filter(
          (s, i) =>
            i === 0 || i === STEP_PLAN.length - 1 || s.sections.length > 0,
        )
        .map((s, i) => ({ ...s, n: i + 1 })),
    [stepSections],
  );

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
   * Move to a step.
   *
   * ⚠️ NO LONGER A TOGGLE. As an accordion this collapsed the step you clicked
   * if you were already on it, so a long section could be shrunk to get at the
   * rest of the form. In a wizard there is only ever one step on screen and
   * "collapse it" means a page with nothing on it — the navigation IS the way
   * to get at the rest of the form now. Scrolls to the top because the step
   * being replaced may have been longer than the screen.
   */
  const go = (n: number) => {
    setExpanded(n);
    setFurthest((f) => Math.max(f, n));
    scrollToTop('smooth');
  };

  /**
   * The rail.
   *
   * ⚠️ THE SAME `outstanding` THE GENERATE GATE USES. If the rail counted
   * differently from the gate, a form could show six green ticks and still be
   * refused — which is the dead end the union at `outstanding` exists to
   * prevent. One source, two readers.
   */
  // The same step the rail shows, published to the mobile shell header — the
  // rail itself is `hidden lg:block`, so without this a phone has no sense of
  // position in a five-step licence motivation at all.
  //
  // `steps` is filtered from STEP_PLAN (empty middle steps drop out), so the
  // total is its length rather than STEP_PLAN's — the counter has to match the
  // rail the member sees, not the plan behind it.
  const shellStep = useMemo(() => {
    const s = steps.find((x) => x.n === expanded);
    return s ? { label: s.def.label, current: s.n, total: steps.length } : null;
  }, [steps, expanded]);
  useShellStep(shellStep);

  const railSteps = useMemo(
    () =>
      steps.map((s) => {
        const fields = s.sections.flatMap((sec) => sec.fields);
        const missing = fields.filter((f) =>
          outstanding.includes(f.key),
        ).length;
        const answered = fields.filter((f) =>
          (answers[f.key] ?? '').trim(),
        ).length;
        return {
          key: s.def.key,
          label: s.def.label,
          status: stepStatus(s.n, missing, answered),
          // ⚠️ THE SAME `missing` THE STATUS IS DERIVED FROM. The side
          // navigator prints this number; deriving it a second way is how a
          // step ends up amber with "0 to answer" beside it.
          outstanding: missing,
        };
      }),
    [steps, outstanding, answers, expanded],
  );

  /**
   * The whole application in one fraction, for the navigator's meter.
   *
   * ⚠️ REQUIRED FIELDS ONLY, and counted off the SAME sections the steps are
   * built from — not off the registry. A licence type that never renders a
   * section must not have its fields counted as unanswered forever, which is
   * what made the old flat page tell people they had work left on a step that
   * did not exist for them.
   */
  const progress = useMemo(() => {
    const required = steps
      .flatMap((s) => s.sections.flatMap((sec) => sec.fields))
      .filter((f) => f.required);
    return {
      answerable: required.length,
      answered: required.filter((f) => (answers[f.key] ?? '').trim()).length,
    };
  }, [steps, answers]);

  /**
   * Which step owns a section.
   *
   * Sections stay in registry order in the DOM and each one hides itself when
   * its step is not the one on screen — rather than the JSX being re-ordered
   * into step buckets. Every step's sections happen to be contiguous in
   * registry order, so a step never renders its own content out of order, and
   * hiding (rather than moving or unmounting) is what keeps every controlled
   * input mounted and the autosave untouched.
   */
  const stepOfSection = useCallback(
    (sectionName: string): number => {
      const found = steps.find((s) =>
        s.sections.some((sec) => sec.section === sectionName),
      );
      return found ? found.n : 1;
    },
    [steps],
  );

  /** Which step a field key sits on, for the Generate-refusal jump. */
  const stepForKey = useCallback(
    (key: string): number | null => {
      for (const s of steps) {
        if (s.sections.some((sec) => sec.fields.some((f) => f.key === key))) {
          return s.n;
        }
      }
      return null;
    },
    [steps],
  );

  // Open the first step that still has something outstanding, rather than
  // assuming step 1 exists. A returning applicant lands on the work left to do.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || loading || !sections.length) return;
    opened.current = true;
    const firstIncomplete = steps.find((s) =>
      s.sections.some((sec) =>
        sec.fields.some((f) => outstanding.includes(f.key)),
      ),
    );
    setExpanded(firstIncomplete ? firstIncomplete.n : 1);
  }, [loading, sections, steps, outstanding]);

  /**
   * The applicant's own open/shut choices, and the first-sight default.
   *
   * Two stores because they answer different questions: the ref remembers what
   * we decided before anybody touched it (and must never be recomputed — see
   * the note where it is filled), the state remembers what they clicked.
   */
  const groupOpenInit = useRef<Record<string, boolean>>({});
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});

  /** One registry field, with the "replace what you wrote?" offer above it. */
  const renderField = (f: MotivationField) => (
    <div key={`${f.key}-w`}>
      {/* WE ASK BEFORE REPLACING. The applicant has written their own words in
          this box, so a new discipline choice offers its rules rather than
          overwriting them. */}
      {prefillOffer?.key === f.key && (
        <div className="mb-2 rounded border border-[var(--gold-line)] bg-[var(--gold-wash)] p-3 text-sm">
          <p>
            You have written your own answer here. Replace it with the published
            rules for {prefillOffer.label}?
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
        field={f}
        value={answers[f.key] ?? ''}
        missing={outstanding.includes(f.key)}
        locked={
          (prefilled.current?.has(f.key) ?? false) && !unlocked.has(f.key)
        }
        onUnlock={() => setUnlocked((u) => new Set(u).add(f.key))}
        onChange={(v) => setAnswer(f.key, v)}
        onPick={pickOption}
        onPickMulti={pickMulti}
      />
      {/* ⚠️ THE PICKERS ARE GONE FROM HERE, and the documents fill these boxes
          instead. A camera, a file picker and a dropdown hanging under two
          questions duplicated the checklist below — the same three controls,
          for the same two documents, in a second place — and the operator's
          word for the result was cluttered. Attach the competency certificate
          in the documents section and this fills itself; see the note on
          applying suggestions in addOneUpload.

          ⚠️ EXCEPT WHERE THE EVIDENCE IS THE ARGUMENT — see attachKind.
          Operator, items 8 and 10, 2026-08-24: the hunting record and the
          competition record "should also have a upload/camera option", with
          "a list of attachments as the applicant gives them". That is not the
          case the clutter complaint was about: those documents ANSWER a
          question and belonged on the checklist, while a target or a register
          page SUPPORTS a claim the applicant is writing in the box directly
          above it, and asking them to remember it four steps later is how it
          never gets attached. Three fields carry this, not 199. */}
      {f.attachKind && (
        <FieldAttachments
          field={f}
          kind={f.attachKind}
          uploads={uploads}
          busy={busyKind === f.attachKind}
          onAdd={(files) => attachToField(f.attachKind as string, files)}
          onRemove={removeOneUpload}
        />
      )}
    </div>
  );

  /**
   * A section's fields, with the repeating ones bundled into collapsibles.
   *
   * ⚠️ PRESENTATION ONLY — THE SECTION IS NEVER SPLIT. Grouping happens on the
   * already-filtered field list; groupBySection, the registry and the
   * required-field counting are all untouched, and every field is rendered
   * exactly once whether it lands in a group or not.
   *
   * ⚠️ ASSOCIATION 1 HAS NO NUMBER IN ITS KEYS. It is `association_name` /
   * `association_number` / `dedicated_since` while 2 and 3 are
   * `association_2_*` / `association_3_*`. A single regex over `_(\d)_` finds
   * only the second and third, which would have left the first association's
   * boxes loose above two tidy collapsibles.
   */
  type FieldGroup =
    | { kind: 'plain'; id: string; fields: MotivationField[] }
    | {
        kind: 'item';
        id: string;
        title: string;
        subtitle: string;
        missing: number;
        open: boolean;
        fields: MotivationField[];
      };

  const groupFields = (sec: { section: string; fields: MotivationField[] }): FieldGroup[] => {
    const val = (k: string) => (answers[k] ?? '').trim();

    /** Bundle `fields` into one collapsible per item. */
    const bundle = (
      slotOf: (key: string) => string | null,
      label: (slot: string) => string,
      summary: (slot: string) => string,
    ): FieldGroup[] => {
      const out: FieldGroup[] = [];
      const bySlot = new Map<string, MotivationField[]>();
      const order: string[] = [];
      // ⚠️ A SLOT'S PLACE IS RESERVED WHERE ITS FIRST FIELD APPEARS, not
      // appended after the loop. Building the items afterwards put every loose
      // field AHEAD of every collapsible, however far down the section it
      // really sits — so `overlap_justification`, which the registry puts last
      // and which only exists once there IS an overlap, led the section it is
      // meant to close: a 2000-character "anything you want us to lead with"
      // textarea as the first thing in "Firearms you already own", above the
      // firearms it is asking about.
      const at = new Map<string, number>();
      for (const f of sec.fields) {
        const slot = slotOf(f.key);
        if (slot === null) {
          // Not part of a repeating item — stays loose, in registry order.
          out.push({ kind: 'plain', id: f.key, fields: [f] });
          continue;
        }
        if (!bySlot.has(slot)) {
          bySlot.set(slot, []);
          order.push(slot);
          // Hold the position; the real group replaces it below.
          at.set(slot, out.push({ kind: 'plain', id: `hold-${slot}`, fields: [] }) - 1);
        }
        bySlot.get(slot)!.push(f);
      }
      for (const slot of order) {
        const fields = bySlot.get(slot)!;
        const missing = fields.filter((f) =>
          outstanding.includes(f.key),
        ).length;
        const filled = fields.some((f) => val(f.key));
        const id = `${sec.section}-${slot}`;
        // ⚠️ DECIDED ONCE, NEVER FROM THE LIVE VALUE. Open-an-empty-item is a
        // sensible default and a catastrophic live rule: `filled` and
        // `missing` both change on every keystroke, so a panel opened because
        // it was empty would SHUT ITSELF the moment somebody filled its first
        // box — collapsing the form under the cursor they were typing in.
        // This is the same trap as the prefilled lock: work the default out
        // the first time the item is seen, then leave it to the DOM and to
        // whatever the applicant themselves clicks.
        if (!(id in groupOpenInit.current)) {
          groupOpenInit.current[id] = !filled || missing > 0;
        }
        out[at.get(slot)!] = {
          kind: 'item',
          id,
          title: label(slot),
          subtitle: summary(slot),
          missing,
          open: groupOpen[id] ?? groupOpenInit.current[id],
          fields,
        };
      }
      return out;
    };

    if (isRepeatingSection(sec.section)) {
      const noun = sec.section === OWNED_SECTION ? 'Firearm' : 'Association';
      return bundle(
        (k) => slotOfKey(sec.section, k),
        (slot) => {
          const k = nameKeyFor(sec.section, slot);
          return (k && val(k)) || `${noun} ${slot}`;
        },
        (slot) =>
          summaryKeysFor(sec.section, slot)
            .map(val)
            .filter(Boolean)
            .join(' · ') || 'Nothing filled in yet — tap to add',
      );
    }

    return sec.fields.map((f) => ({
      kind: 'plain' as const,
      id: f.key,
      fields: [f],
    }));
  };

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

  // ⚠️ RENDERED, BUT NEVER WHILE THE DOCUMENT IS BEING WRITTEN. This page
  // skips a poll tick whenever a blocking overlay is up, so a consent window
  // over a running generation would stop the wizard noticing its own
  // generation finish — somebody would sit watching "Writing it…" behind a
  // notice. The window is opened deliberately from a document slot, which is
  // never a moment when a generation is running; the guard is for the case
  // where it somehow is.
  const consentOverlay =
    askConsent && !generating && clerkUserId ? (
      <VaultConsentModal
        token={token}
        userId={clerkUserId}
        retentionDays={retentionDays}
        onDone={(agreed) => {
          setAskConsent(false);
          if (agreed) void loadLibrary();
        }}
      />
    ) : null;

  return (
    <>
      {consentOverlay}
      <main className="mx-auto max-w-3xl px-4 py-6 lg:max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Your firearm licence motivation</h1>
        {/* THE MEMBER'S OWN NAME FOR THIS ONE — see the label state above for
          * why it lives here rather than on `detail`. Purely a list label:
          * it is never read into the answers, the document, or anything the
          * Registrar sees. */}
        {renamingLabel ? (
          <div className="mt-1 flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveLabel(labelValue);
                if (e.key === 'Escape') {
                  setRenamingLabel(false);
                  setLabelError(null);
                }
              }}
              maxLength={80}
              placeholder="Name this application, e.g. Home defence"
              className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--border-hover)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void saveLabel(labelValue)}
              disabled={labelSaving}
              className="rounded bg-[var(--red)] px-3 py-1.5 text-sm text-white hover:bg-[var(--red-hover)] disabled:opacity-60"
            >
              {labelSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRenamingLabel(false);
                setLabelError(null);
              }}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg-card-hover)]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setLabelValue(label ?? '');
              setLabelError(null);
              setRenamingLabel(true);
            }}
            aria-label={label ? 'Rename this application' : 'Name this application'}
            className="mt-1 flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <span>{label || licenceLabel || 'Name this application'}</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
        )}
        {labelError && (
          <p className="mt-1 text-xs text-[var(--red)]" role="alert">
            {labelError}
          </p>
        )}
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

      {/* WHAT WE READ OFF A DOCUMENT, ABOVE THE RAIL AND ON EVERY STEP.
        *
        * ⚠️ IT USED TO LIVE INSIDE THE DOCUMENTS SECTION, which is now step 1
        * — so a licence photographed from step 3 ("Firearms you already own",
        * where the "photograph a licence instead of typing it" button is)
        * produced a confirmation panel on a screen the applicant was not
        * looking at. They would have had to guess that accepting it meant
        * navigating back to step 1. Anything that CONFLICTS with what they
        * typed has to be answerable wherever they are standing.
        *
        * Not an overlay: it must not take a `data-blocking-overlay`, or it
        * would stand the 20s poll down for as long as it is up. */}
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
                // Accepted off a document, so they read as doc-sourced from
                // here on — greyed, with the pen. Safe to mark outside an
                // updater unlike the autofill above: every one of these IS
                // written, because the applicant just said so.
                if (prefilled.current) {
                  for (const k of Object.keys(accept)) {
                    prefilled.current.add(k);
                  }
                }
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

      {/* ⚠️ NOT A MISSING ANSWER — SOMETHING THAT CANNOT BE GRANTED.
        *
        * missingRequired says "you have not finished"; this says "what you
        * have described is not permitted". A rifle cannot be licensed under
        * section 13 at all, and a competency that does not cover the firearm
        * is refused before the application is considered. Telling somebody to
        * fill in the rest of a form that cannot succeed is worse than telling
        * them nothing.
        *
        * Above the rail, on every step, for the same reason the extraction
        * confirm sits there: the fix is usually on a different step from the
        * one they are standing on. Red rather than gold — gold is advice, and
        * this is not advice. */}
      {(detail.blockers?.length ?? 0) > 0 && (
        <div
          role="alert"
          className="mb-4 rounded border border-[var(--red)] bg-[rgba(200,16,46,0.08)] p-3"
        >
          <p className="text-sm font-medium">
            This application cannot be granted as it stands
          </p>
          <ul className="mt-2 space-y-2">
            {detail.blockers!.map((b) => (
              <li key={b.code} className="text-sm text-[var(--text-secondary)]">
                {b.message}
                {stepForKey(b.field) ? (
                  <button
                    type="button"
                    className="ml-2 underline underline-offset-2 hover:text-[var(--text-primary)]"
                    onClick={() => go(stepForKey(b.field) as number)}
                  >
                    Take me there
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ⚠️ NEVER SILENT. Documents were added to a licence application without
        * being asked for — that is a convenience only while the member can see
        * it happened and undo it. An unannounced change to what a DFO will see
        * is the difference between "it filled itself in" and "something else
        * is filling in my police paperwork".
        *
        * Green, because this is the one banner on the page that is purely good
        * news: nothing is required of them. */}
      {autolinked.length > 0 && (
        <div className="mb-4 rounded border border-[rgba(47,158,107,0.38)] bg-[rgba(47,158,107,0.10)] p-3">
          <p className="text-sm font-medium">
            We added {autolinked.length}{' '}
            {autolinked.length === 1 ? 'document' : 'documents'} from your
            Document Centre
          </p>
          <ul className="mt-1 text-xs text-[var(--text-secondary)]">
            {autolinked.map((a) => (
              <li key={a.kind}>{a.title}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--text-tertiary-on-card)]">
            They are in your documents step, and you can remove any of them
            there.
          </p>
        </div>
      )}

      {/*
        ── THE WIZARD'S TWO SHAPES ──────────────────────────────────────

        Operator, 2026-08-24: "We are going to go for the side view option."

        ⚠️ BOTH RENDER, ONE IS HIDDEN BY BREAKPOINT — they are not swapped by a
        media query in JS. A `useMediaQuery` here would render the wrong one on
        the server, flash on hydration, and put a resize listener on a page
        that already runs two polls and a debounced save.

        ⚠️ AND THE CONTENT COLUMN IS `min-w-0`. Without it a grid item refuses
        to shrink below its widest child, and this form contains a table of
        owned firearms and several long single-line values — the column would
        push the navigator off-screen instead of scrolling inside itself.
      */}
      <div className="lg:hidden">
        <MotivationStepRail
          steps={railSteps}
          current={expanded}
          onJump={go}
        />
      </div>

      <div className="lg:grid lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start lg:gap-8">
        {/* ⚠️ THE SIDE NAV STAYS, AND THE RAIL IS NOT A REPLACEMENT FOR IT.
            The rail is the house progress display now required on every
            multi-step flow (operator, 2026-08-27), and it renders above the
            form. This side nav does something the rail cannot: it shows,
            per step, how many questions are answered out of how many are
            answerable — which is what tells someone why the Generate button
            is still refusing. Losing that would make the gate inexplicable.
            One says WHERE you are, the other says WHAT IS LEFT. */}
        <MotivationStepNav
          steps={railSteps}
          current={expanded}
          onJump={go}
          answered={progress.answered}
          answerable={progress.answerable}
          className="hidden lg:block lg:sticky lg:top-4"
        />

        <div className="min-w-0">
          {/* The house step rail, on every multi-step flow. Desktop only —
              below md the shell header carries the compact "You & firearm ·
              Step 2 of 5" row instead, published by the useShellStep call
              further up. `complete` mirrors the side nav's own reckoning so
              the two can never disagree about which steps are done. */}
          <StepRail
            steps={steps.map((st, i) => ({
              label: st.def.label,
              // The side nav's own reckoning, so the two can never disagree
              // about which steps are done: nothing outstanding means done.
              complete: railSteps[i]?.outstanding === 0,
            }))}
            current={expanded}
            mobile="shell"
            onJump={go}
            className="-mx-4 mb-6"
          />

      {/* The step's own heading. One per step, all but the current one hidden
          — see the note on stepOfSection for why nothing is unmounted. */}
      {steps.map((s) => (
        <div key={`h-${s.def.key}`} hidden={expanded !== s.n} className="mb-4">
          <h2 className="text-lg font-semibold">{s.def.title}</h2>
          {s.def.blurb && (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {s.def.blurb}
            </p>
          )}
        </div>
      ))}

      {/* Documents FIRST.
        *
        * Operator, 2026-08-19: take the documents up front, because there is a
        * lot we can read off them. An ID carries the name and ID number (and
        * therefore date of birth, age, gender and citizenship); a competency
        * certificate its number and dates; a licence the make, calibre and
        * serial of a firearm they already own — which is exactly what the
        * overlap check needs. Re-typing all that off a card in your hand is the
        * part of a form people abandon. */}
      <div hidden={expanded !== 1}>
      <section className="mb-6 rounded border border-[var(--border)] bg-[var(--bg-card)] p-4">
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

                // ⚠️ THE CHARACTER REFERENCE ROW HAS NO UPLOAD AT ALL, and
                // that is the point of it now. Witnesses complete and sign
                // from a link — there is no paper to photograph, nothing in a
                // library to reuse and no file to attach, so a camera button
                // and a paperclip on this row are three ways to start a task
                // that does not exist. Operator, 2026-08-21: "Move the two
                // invites to [this row] and remove the upload function from it
                // completely."
                if (k === 'CHARACTER_REFERENCE') {
                  return (
                    <span className="block w-full">
                      <MotivationWitnesses motivationId={id} />
                    </span>
                  );
                }

                // ⚠️ SEVERAL FILES, ONE AFTER ANOTHER. This took files[0] and
                // dropped the rest, which was harmless while every row wanted
                // exactly one document and is not any more: the safe is one
                // row holding three photographs. Operator, 2026-08-23: "User
                // must be able to upload multiple documents."
                //
                // ⚠️ SEQUENTIAL, NOT Promise.all. Each upload counts the rows
                // already on the motivation against MAX_UPLOADS and writes a
                // new one; firing them together would let three reads all see
                // the same count. It also keeps the first real error visible
                // instead of whichever rejection happened to land last.
                const take = async (files: File[]) => {
                  if (!files.length) return;
                  setBusyKind(k);
                  setUploadErr(null);
                  try {
                    for (const file of files) await addOneUpload(k, file);
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
                      keeping={keeping}
                      onTurnOn={() => setAskConsent(true)}
                    />
                    <ScanButton
                      compact
                      shape={shapeForKind(k)}
                      // Same question the FilePickerButton below already asks:
                      // a row that wants three photographs should open ready to
                      // take three. Without this, "Add 3 here" opened a scanner
                      // set to one and the member had to find the checkbox.
                      multiDefault={(r.minFiles ?? 1) > 1}
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
                          // A row that wants three photographs should take
                          // three in one go. Picking them one at a time is the
                          // slowest possible way to hand over pictures the
                          // member already has together on their phone.
                          multiple={(r.minFiles ?? 1) > 1}
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

                    {/*
                      ⚠️ THE CONSENT SITS ON THIS ROW BECAUSE THIS ROW IS THE
                      CONSENT. Operator, 2026-08-23, pointing at it: "it should
                      sit here." The row's own description already says so —
                      "the dealer's invoice or quote, OR a letter from the
                      person who currently owns the firearm saying they agree
                      to you applying for a licence over it."

                      It was on SELLER_LICENCE, which is wrong twice over: that
                      row only appears once the buyer has declared a private
                      transfer, so the option was invisible to anybody who had
                      not; and the seller's licence is EVIDENCE the owner is
                      entitled to consent, not the consent itself.

                      ⚠️ ADDED TO THE CONTROLS, NOT INSTEAD OF THEM. A dealer
                      buyer uploads an invoice on this same row, and the
                      character-reference row's pattern — replace everything,
                      because there is no paper — does not apply here. Both
                      routes are served from one row.
                    */}
                    {k === 'FIREARM_SOURCE_PROOF' && (
                      <MotivationSellerConsent
                        motivationId={id}
                        applicantName={(answers.full_name ?? '').trim()}
                        firearm={{
                          make: answers.firearm_make,
                          model: answers.firearm_model,
                          type: answers.firearm_type,
                          calibre: answers.firearm_calibre,
                          serial: answers.firearm_serial,
                          applicantName: (answers.full_name ?? '').trim(),
                          applicantIdNumber: answers.id_number,
                        }}
                        // ⚠️ THROUGH setAnswer, NOT A DIRECT WRITE — so the
                        // adopted card details ride the page's own autosave
                        // instead of being clobbered by the next one. The card
                        // is the government record, so it OVERWRITES here (no
                        // onlyIfEmpty): that is the whole point of adopting it.
                        onAdopt={(fields) => {
                          for (const [k, v] of Object.entries(fields)) {
                            setAnswer(k, v);
                          }
                        }}
                      />
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

      </section>

      {/* The profile offer — a plain card inside step 1.
        *
        * ⚠️ IT WAS AN ACCORDION AND MUST NOT BE ONE HERE. The step it lives on
        * is already the thing being expanded and collapsed; a second header
        * inside it toggled `expanded` to the value it already had, so the
        * header looked clickable and did nothing — exactly the "looks tappable
        * but is not" trap the witness rail refuses. It is one short offer, so
        * it simply shows. */}
      {offer && offer.fields.length > 0 && !offer.alreadyConsented && (
        <section className="mb-6 rounded border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <h3 className="font-medium">Use what we already have?</h3>
          {offer.note && (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {offer.note}
            </p>
          )}
          <div className="mt-3 space-y-3">
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
        </section>
      )}
      </div>

      {/* The registry sections. Each one hides itself unless its step is the
          one on screen — see stepOfSection. */}
      {sections.map((sec) => {
        const n = stepOfSection(sec.section);
        const isOwned = sec.section === 'Firearms you already own';
        // The step heading already names a single-section step; repeating it
        // on the card would be the same words twice on one screen.
        const soleSection =
          (steps.find((s) => s.n === n)?.sections.length ?? 1) === 1;
        return (
          <section
            key={sec.section}
            hidden={expanded !== n}
            className="mb-4 rounded border border-[var(--border)] bg-[var(--bg-card)] p-4"
          >
            {!soleSection && (
              <h3 className="mb-3 font-medium">{sec.section}</h3>
            )}
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
                  {/* Shown while they are still filling the form, next to the
                      firearms they have just typed. ⚠️ IT IS A HEADS-UP, NOT A
                      TASK: the writer argues the comparison itself now, and the
                      box below it is optional. Operator, 2026-08-22, on being
                      asked to supply the reason — "it is the job of the AI to
                      do research as to why the applicant would need this
                      firearm and justify it for them". */}
                  <p className="font-medium">We noticed, and we cover it</p>
                  <p className="mt-1 text-[var(--text-secondary)]">
                    {detail.overlap.prompt}
                  </p>
                </div>
              )}
              {groupFields(sec).map((grp) =>
                grp.kind === 'plain' ? (
                  /*
                   * ⚠️ KEYED, AND THE ARRAY IT REPLACES WAS A REAL BUG. Returning
                   * a bare array from a .map arm gives React no key for the arm
                   * itself, so the children are reconciled BY POSITION. Any
                   * field that appears or disappears mid-section — answering
                   * marital_status = "Married" inserts spouse_name — would then
                   * destroy and recreate every field after it, losing focus,
                   * selection and IME state in whatever box the applicant was
                   * in. `grp.id` is the field key, so this restores the
                   * key-based identity the fields had before they were grouped.
                   */
                  <Fragment key={grp.id}>{grp.fields.map(renderField)}</Fragment>
                ) : (
                  /*
                   * ONE REPEATING ITEM, COLLAPSED.
                   *
                   * Operator, 2026-08-24: "for something like the firearm
                   * details where there is a lot of inputs, hide each
                   * firearm's detail underneath a theme-matching dropdown. Do
                   * the same for similar items."
                   *
                   * Six firearms × seven boxes is forty-two inputs in a
                   * column in front of somebody who owns one firearm. Each
                   * item now shows its NAME and hides its details until
                   * asked.
                   *
                   * ⚠️ NATIVE <details>, NOT A JS ACCORDION. `.gg-disclose`
                   * is the house disclosure (globals.css) — it costs no
                   * JavaScript, is keyboard- and screen-reader-accessible
                   * for free, and its "+" turns 45° and red on open, which
                   * is what makes this theme-matching rather than merely
                   * collapsible. The fields inside stay MOUNTED whether open
                   * or shut (that is how <details> works), so nothing here
                   * touches the autosave or the required-field counting.
                   */
                  <details
                    key={grp.id}
                    className="gg-disclose rounded border border-[var(--border)] bg-[var(--bg-inset)]"
                    open={grp.open}
                    onToggle={(e) => {
                      const open = (e.currentTarget as HTMLDetailsElement).open;
                      setGroupOpen((cur) =>
                        cur[grp.id] === open ? cur : { ...cur, [grp.id]: open },
                      );
                    }}
                  >
                    <summary className="flex cursor-pointer items-center justify-between gap-3 p-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {grp.title}
                        </span>
                        <span className="block truncate text-xs text-[var(--text-tertiary-on-card)]">
                          {grp.subtitle}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        {grp.missing > 0 && (
                          <span
                            className="gg-nums text-xs"
                            style={{ color: 'var(--warning)' }}
                          >
                            {grp.missing} to answer
                          </span>
                        )}
                        <span className="gg-disclose-mark" aria-hidden="true">
                          +
                        </span>
                      </span>
                    </summary>
                    <div className="space-y-4 border-t border-[var(--border-divider)] p-3">
                      {grp.fields.map(renderField)}
                      {/* Clearing the boxes, not re-keying the rows. A
                          middle row that shifted up would move every answer
                          after it into a different key — and the overlap
                          check reads any index, so an emptied row simply
                          prints blank and can be filled again. */}
                      <button
                        type="button"
                        className="text-xs underline text-[var(--text-tertiary-on-card)]"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Clear ${grp.title}? The boxes are emptied — nothing else is affected.`,
                            )
                          ) {
                            return;
                          }
                          for (const f of grp.fields) {
                            // ⚠️ UNMARK BEFORE EMPTYING, OR THE BOXES COME BACK
                            // BLANK AND READ-ONLY. Every column of an owned
                            // firearm is docSourced, so reading a licence marks
                            // them all — and `locked` asks only whether a key is
                            // marked, never whether a value is still in it. The
                            // clear promised "the boxes are emptied"; without
                            // this it delivered seven grey panels that cannot be
                            // typed into until each is unlocked by its own pen.
                            //
                            // This does not break the add-only rule. That rule
                            // stops a SKIPPED write from locking an answer the
                            // applicant typed; this is the applicant explicitly
                            // throwing the document's value away, which is
                            // exactly when the mark should go with it.
                            prefilled.current?.delete(f.key);
                            setAnswer(f.key, '');
                          }
                        }}
                      >
                        Clear this one
                      </button>
                    </div>
                  </details>
                ),
              )}
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
          </section>
        );
      })}

      {/* One Continue per step, after that step's cards. The last step ends
          with Generate instead, so it gets none. */}
      {steps.map((s) =>
        s.n === steps.length ? null : (
          <div key={`c-${s.def.key}`} hidden={expanded !== s.n} className="mb-6">
            <button
              type="button"
              className="rounded bg-[var(--red)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--red-hover)]"
              onClick={() => go(s.n + 1)}
            >
              Continue
            </button>
          </div>
        ),
      )}

      <div hidden={expanded !== steps.length}>

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
            layout={template.layout}
            // Defaults to marked when the server did not say. Erring the other
            // way would show a clean preview of a document that arrives
            // stamped, which is selling something we do not hand over.
            watermarked={detail.watermarked !== false}
            onChange={chooseTemplate}
            saving={templateSaving}
            error={templateError}
          />

          {/* ── The cover photograph ──────────────────────────────
              Inside the template card rather than beside it: both are choices
              about how the pack LOOKS, neither changes a word the document
              argues, and both stay live after it is written because the PDF is
              re-rendered from stored text on every download. */}
          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <MotivationCoverPhoto motivationId={id} />
          </div>
        </section>
      )}


      {/* 5 — declaration and generate */}
      <section className="mt-6 rounded border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <h2 className="font-medium">Before we prepare it</h2>
        {detail.status === 'GENERATING' ? (
          // Offering "Prepare my motivation" here would earn a 409 from the
          // compare-and-swap and read as a broken button.
          //
          // ⚠️ "ABOUT A MINUTE" WAS NOT TRUE. A measured run took 15:00:46 to
          // 15:05:40 — five minutes — and the copy is why the operator sat
          // watching a button instead of closing the tab. Say the real shape
          // of the wait and say they are free to go.
          //
          // ⚠️ AND IT PROMISES A NOTIFICATION NOTHING SENDS YET. Nothing in
          // backend/src/motivations calls NotificationsService, on the
          // transition to COMPLETED or to NEEDS_MORE_INFO. Wiring it is the
          // next thing to build; until it is, this sentence is the second
          // untrue thing on this screen.
          <p className="mt-2 text-sm" role="status">
            We are writing it now. It takes a few minutes. You can leave this
            page — we will send you an SMS and an email once it is ready, and
            it will be here when you come back.
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
                      'This is taking longer than usual. It is still being written — you can close this page; we will send you an SMS and an email once it is ready.',
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
                    // Jump to the STEP holding the first missing field. The
                    // whole point of naming them is that the applicant can get
                    // to them; a message about a field on a step they are not
                    // on is the dead end this replaced.
                    const target = e.missing
                      .map(stepForKey)
                      .find((n): n is number => n !== null);
                    if (target) go(target);
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
                ? 'Writing it — a few minutes…'
                : 'Prepare my motivation'}
            </button>

            {/* ⚠️ THE STATUS LINE ABOVE IS NEVER REACHED FROM HERE. `detail`
                is only re-read once the poll loop ends, so for the whole run
                the page is still on this branch and a disabled button label
                is the only thing on screen to read — which is exactly how
                five minutes got spent watching one. The same promise has to
                be made beside the button, not only to whoever comes back to
                a GENERATING row later. */}
            {generating && (
              <p
                className="mt-3 text-sm text-[var(--text-secondary)]"
                role="status"
              >
                It takes a few minutes. You do not have to wait here — you can
                leave this page and we will send you an SMS and an email once
                it is ready.
              </p>
            )}
          </>
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
      </div>

        </div>
      </div>
    </main>
    </>
  );
}

/** One question, rendered from its registry definition. */
/**
 * Evidence attached to one question, and the running list of it.
 *
 * Operator, items 8 and 10, 2026-08-24: "Upload and camera button. Make a list
 * of attachments as the applicant gives them."
 *
 * ⚠️ THE CAMERA IS A SEPARATE CONTROL FROM THE FILE PICKER, and on a phone
 * that matters: capture="environment" opens the rear camera directly, where a
 * bare file input opens a chooser the member then has to navigate. Both are
 * offered because a target photographed today and a register page already
 * scanned as a PDF are both legitimate here.
 *
 * ⚠️ AND IT TAKES ANYTHING. Operator on association activities: "there might
 * be targets that's uploaded so prepare for different types of formats and
 * documents." Images and PDFs both — the pack embeds JPEG and PNG directly and
 * splices PDF pages in whole, so all three print.
 */
function FieldAttachments({
  field,
  kind,
  uploads,
  busy,
  onAdd,
  onRemove,
}: {
  field: MotivationField;
  kind: string;
  uploads: UploadRow[];
  busy: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const mine = uploads.filter((u) => u.kind === kind);
  return (
    <div className="mt-2 rounded border border-[var(--border)] bg-[var(--bg-inset)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilePickerButton
          compact
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          disabled={busy}
          onFiles={(files) => onAdd(files)}
          aria-label={`Attach a file to ${field.label}`}
        >
          Attach a file
        </FilePickerButton>
        <FilePickerButton
          compact
          accept="image/*"
          capture="environment"
          disabled={busy}
          onFiles={(files) => onAdd(files)}
          aria-label={`Photograph something for ${field.label}`}
        >
          Take a photo
        </FilePickerButton>
        {busy && (
          <span className="text-xs text-[var(--text-secondary)]">
            Uploading…
          </span>
        )}
      </div>

      {mine.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {mine.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="min-w-0 truncate text-[var(--text-secondary)]">
                {/* The annexure letter is what a DFO will look for, so show it
                    the moment it exists rather than only in the pack. */}
                {u.annexure ? `Annexure ${u.annexure} · ` : ''}
                {u.label}
              </span>
              <button
                type="button"
                className="shrink-0 rounded px-2 py-0.5 text-[var(--text-tertiary-on-card)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
                onClick={() => onRemove(u.id)}
                aria-label={`Remove ${u.label}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-[var(--text-tertiary-on-card)]">
          Nothing attached yet. Anything you add here also counts towards your
          documents.
        </p>
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  missing,
  locked = false,
  onUnlock,
  onPick,
  onPickMulti,
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
  onPickMulti?: (field: MotivationField, values: string[]) => void;
  onChange: (v: string) => void;
}) {
  // EXPLICIT background and colour on every control.
  //
  // ⚠️ The reason below still holds; the premise it used to give did not. It
  // said "the site is dark (--bg #0f0f0f)" — true before the white retail
  // skin, and wrong since. <body> sets its text colour explicitly, but a
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
      {field.optionGroups && field.kind !== 'multi' && (
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

      {/* ⚠️ A GROUPED MULTI IS NOT A ROW OF CHECKBOXES. This renderer draws
          one box per `choices` entry, which is right for the three competency
          types and hopeless for fifty-nine disciplines in eleven groups — and
          would have drawn NOTHING at all, because an optionSource field has no
          `choices` array. Grouped multi-selects get chips-plus-a-picker
          below. */}
      {field.kind === 'multi' && !field.optionGroups && (
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
      {/* A GROUPED MULTI — the shooting disciplines.
          Chips for what is chosen, a picker to add the next one. The same
          shape the operator asked for on associations: the list you have is
          visible and removable, and adding another is one deliberate act
          rather than a wall of fifty-nine checkboxes. */}
      {field.kind === 'multi' && field.optionGroups && (
        <MultiPicker field={field} value={value} onPickMulti={onPickMulti} />
      )}

        </>
      )}
    </div>
  );
}

/**
 * Chips plus a picker, for a multi-select whose options are grouped.
 *
 * Values are stored comma-joined, which is what the server validates and
 * normalises — see the `multi` branch of saveAnswers.
 */
function MultiPicker({
  field,
  value,
  onPickMulti,
}: {
  field: MotivationField;
  value: string;
  onPickMulti?: (field: MotivationField, values: string[]) => void;
}) {
  const chosen = value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const all = field.optionGroups?.flatMap((g) => g.options) ?? [];
  const labelFor = (v: string) =>
    all.find((o) => o.value === v)?.label ?? v;

  const set = (next: string[]) => {
    // Normalised to the offered order, so our ordering and the server's agree
    // and two identical answers compare equal.
    const order = all.map((o) => o.value);
    const known = order.filter((v) => next.includes(v));
    // Anything we do not recognise is still their answer — keep it, at the end.
    const unknown = next.filter((v) => !order.includes(v));
    onPickMulti?.(field, [...known, ...unknown]);
  };

  return (
    <div className="mt-1">
      {chosen.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {chosen.map((v) => (
            <li key={v}>
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-inset)] py-1 pl-3 pr-1 text-sm">
                {labelFor(v)}
                <button
                  type="button"
                  aria-label={`Remove ${labelFor(v)}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
                  onClick={() => set(chosen.filter((x) => x !== v))}
                >
                  &times;
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <select
        id={field.key}
        className="w-full rounded border border-[var(--border)] bg-[var(--bg-card)] p-2 text-sm"
        value=""
        onChange={(e) => {
          if (!e.target.value) return;
          set([...chosen, e.target.value]);
        }}
      >
        <option value="">
          {chosen.length ? 'Add another discipline…' : 'Choose a discipline…'}
        </option>
        {field.optionGroups?.map((g) => {
          const left = g.options.filter((o) => !chosen.includes(o.value));
          if (!left.length) return null;
          return (
            <optgroup key={g.group} label={g.group}>
              {left.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
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
    // ⚠️ NOT setFiled([]). This queue is the only screen that asks a human to
    // confirm what each document is, and the add panel closes after every
    // hand-off — so clearing here means a second batch wipes the first batch's
    // unconfirmed rows off the screen. The Document Centre lost six licences
    // this way; this page had grown the same bug independently.
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

    setFiled((cur) => mergeReviewQueue(cur, named));
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
