'use client';

// ────────────────────────────────────────────────────────────────────
// THE LICENCE APPLICATION WIZARD. Built to the design mockup.
//
// ⚠️ THIS REPLACED A FLAT PACK SCREEN ON 2026-08-29, AND THE REASON IS WORTH
// KEEPING. The build plan contradicts itself: §3.0c says "the design is now a
// ten-step wizard rather than a single pack screen", and §8's Phase 2 still
// describes the pack screen it superseded. The first version of this route
// followed §8, which was the stale half — nobody compared it against the
// artboard until the operator asked how the two matched, and the answer was
// that they were different information architectures.
//
// The mechanics here are the mockup's, read off Main.dc.html rather than
// approximated: one panel visible at a time, a clickable rail of numbered
// dots, a fixed 340px SAPS 271 column on every step, and a Back / hint /
// Continue footer. Operator, 2026-08-29: "I want to match the mechanics of how
// it works and visually appears with styling and flow. Not word for word the
// same."
//
// ⚠️ TEN STEPS, NOT THE ARTBOARD'S NINE — the licence section leads. Operator:
// "I added the Section list as it is already there and obvious to have."
//
// ⚠️ BEHIND A FLAG, AND THE FLAG IS OFF. See lib/licence-services-preview.ts.
// ────────────────────────────────────────────────────────────────────

import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  motivationsApi,
  MotivationApiError,
  type MotivationField,
  type MotivationPack,
  Suggestion,
  UploadRow,
  PickableKind,
  LibraryItem,
  TokenGetter,
  SAPS271_OPT_KEY,
  SAPS271_FILL,
  DocumentStatus,
  FollowUp,
} from '@/lib/motivations-api';
import { readDraft } from '@/lib/motivation-draft';
import { licenceLabel, LICENCE_SECTION } from '@/lib/licence-labels';
import {
  PACK_SCREEN_SHIPPED,
  canOpenPackScreen,
  clearPreviewOptIn,
} from '@/lib/licence-services-preview';
import { useMotivationAutosave } from '@/hooks/use-motivation-autosave';
import LibraryPicker from '@/components/library-picker';
import LicenceCentreOfferPanel from '@/components/licence-centre-offer-panel';
import { licenceCentreApi } from '@/lib/licence-centre-api';
import BulkCapture from '@/components/licence-pack/bulk-capture';
import MotivationSellerConsent from '@/components/motivation-seller-consent';
import FollowUpThread from '@/components/licence-pack/follow-up-thread';
import PackFinish from '@/components/licence-pack/pack-finish';
import { VAULT_PREFIXES } from './vault-prefixes';
import AttachedDocuments from '@/components/licence-pack/attached-documents';
import ExtractionReview from '@/components/licence-pack/extraction-review';
import { mergeReads } from '@/lib/extraction-review-rules';
import ProficiencyAlert from '@/components/licence-pack/proficiency-alert';
import WizardRail, {
  APPLICATION_STEPS,
  DISPLAY_OFFSET,
  toDisplayIndex,
  toWalkedIndex,
  WIZARD_STEPS,
} from '@/components/licence-pack/wizard-rail';
// The one reading of "can this document still answer its row?", shared with the
// live wizard so the two screens cannot disagree about somebody's paperwork.
import { usableUpload } from '@/components/motivation/upload-panel';
import { visibleFields } from '@/lib/motivations-api';
import FieldInput from '@/components/motivation-field-input';
import PackGroup from '@/components/licence-pack/pack-group';
import PrefillBanner from '@/components/licence-pack/prefill-banner';
import Saps271Meter from '@/components/licence-pack/saps271-meter';
import CaptureCards from '@/components/licence-pack/capture-cards';
import ReadResult from '@/components/licence-pack/read-result';
import FieldGrid from '@/components/licence-pack/field-grid';
import YesNoPills from '@/components/licence-pack/yes-no-pills';
import PackSection from '@/components/licence-pack/pack-section';
import DeleteApplication from '@/components/licence-pack/delete-application';

export default function LicenceServicesWizardPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [pack, setPack] = useState<MotivationPack | null>(null);
  const [fields, setFields] = useState<MotivationField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missingRequired, setMissingRequired] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which step the member is on.
   *
   * ⚠️ IT USED TO BE LOST ON EVERY REFRESH. `useState(0)` put somebody on the
   * firearm step after a reload from step nine — and a reload is not rare on a
   * form this long: iOS discards backgrounded tabs, and the phone hand-off asks
   * a member to pick their phone up and put it down again. The step is kept in
   * the URL fragment, which is what WizardStep.key has always said it was for:
   * shareable, restored on load, and costing no draft schema.
   *
   * ⚠️ replaceState, NOT location.hash = — assigning pushes a history entry, so
   * ten steps would take ten presses of Back to leave the application.
   */
  const [step, setStep] = useState(0);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  // Read inside callbacks that must not re-create on every list change.
  const uploadsRef = useRef<UploadRow[]>([]);
  uploadsRef.current = uploads;
  const [pickable, setPickable] = useState<PickableKind[]>([]);
  /** The one document a lifecycle action is working on, so its row can grey. */
  const [docBusy, setDocBusy] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [keeping, setKeeping] = useState<boolean | undefined>(undefined);
  const [autolinked, setAutolinked] = useState<{ kind: string; title: string }[]>([]);
  /**
   * May we invite the seller from here?
   *
   * ⚠️ NOT A NEW ENDPOINT. The server already sets `sellerConsent` on the
   * FIREARM_SOURCE_PROOF need whenever the route is a private sale, and it
   * rides on the uploads response this page has fetched since M2 — so folding
   * it into pack() as well would be a second source of one truth.
   */
  const [sellerInvite, setSellerInvite] = useState(false);
  const [messages, setMessages] = useState<FollowUp[]>([]);
  /**
   * What the pack still needs in the way of DOCUMENTS.
   *
   * ⚠️ IT WAS ON THE UPLOADS RESPONSE ALL ALONG AND NOTHING KEPT IT. The page
   * read `documents` only to work out whether to offer the seller invite, then
   * threw it away — so the Generate gate could see missing ANSWERS and was
   * blind to missing DOCUMENTS, and a member with every box filled and no ID
   * copy met a live button, spent one of a small hourly quota on a flagship
   * model, and was refused.
   */
  const [documents, setDocuments] = useState<DocumentStatus | null>(null);

  const token = useCallback(async () => getToken(), [getToken]);

  useEffect(() => {
    const ok = canOpenPackScreen(window.location.search);
    setAllowed(ok);
    if (!ok) router.replace(`/motivations/${id}`);
  }, [id, router]);

  /**
   * Which step this visit started on. Not always the first.
   *
   * ⚠️ THE PREFILL BANNER RENDERED ON STEP 0 AND NOWHERE ELSE, so a member
   * returning to step seven — after a refresh, or from the phone hand-off —
   * was never told we had filled twenty-three answers in for them. That
   * sentence is the whole reason the values are allowed to be written without
   * being asked about (CLAUDE.md, "Automate It — Do Not Ask": say it was filled
   * in, on the row, in passing). Unsaid, it is just a form somebody else
   * completed.
   */
  const [entryStep, setEntryStep] = useState(0);

  // Restore the step from the URL fragment — see the note on `step`.
  useEffect(() => {
    if (!allowed) return;
    const key = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    const at = APPLICATION_STEPS.findIndex((s) => s.key === key);
    if (at > 0) {
      setStep(at);
      setEntryStep(at);
    }
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    (async () => {
      try {
        const [p, d] = await Promise.all([
          motivationsApi.pack(token, id),
          motivationsApi.get(token, id),
        ]);
        const f = await motivationsApi.fields(token, d.licenceType);
        // The upload list is what makes the attached documents visible and
        // actionable — without it the wizard can add a document and never
        // show it again.
        const up = await motivationsApi.uploads(token, id);
        setUploads(up.files);
        setPickable(up.kinds ?? []);
        setDocuments(up.documents);
        setSellerInvite(sellerConsentOffered(up.documents));
        // ⚠️ THE ONE GAP THAT LEAVES SOMEBODY STUCK RATHER THAN
        // INCONVENIENCED. An unanswered follow-up holds the application at
        // NEEDS_MORE_INFO; without these on screen the pack simply refuses to
        // finish, with no reason given and nothing to do.
        setMessages(await motivationsApi.messages(token, id));
        if (!alive) return;
        setPack(p);
        setFields(f.fields);
        setMissingRequired(d.missingRequired ?? []);
        // The local draft wins: it is newer than the server's copy by exactly
        // the debounce window. Same key as the wizard at /motivations/[id].
        setAnswers({ ...(d.answers ?? {}), ...readDraft(id) });
      } catch (ex) {
        if (!alive) return;
        setError(
          ex instanceof MotivationApiError
            ? ex.message
            : 'We could not open this application.',
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [allowed, id, token]);

  const autosave = useMotivationAutosave({
    id,
    token,
    answers,
    ready: Boolean(pack),
    onResponse: (res) => setMissingRequired(res.missingRequired ?? []),
  });

  const setAnswer = useCallback(
    (key: string, value: string) => {
      autosave.markDirty();
      setAnswers((cur) => ({ ...cur, [key]: value }));
    },
    [autosave],
  );

  // ⚠️ A REF, so a callback that must not be rebuilt on every keystroke can
  // still read what is on screen NOW. Putting `answers` in a dependency list
  // here would rebuild the phone-arrival handler on every character typed —
  // and ScanButton holds the handler it was given when its dialog opened.
  const answersRef = useRef(answers);
  answersRef.current = answers;

  /**
   * ONE UPLOAD, ONE CODE PATH — the same discipline the wizard's own
   * addOneUpload keeps, and for the same reason: every door on this screen
   * funnels through here so they cannot drift on what happens after a file
   * lands.
   *
   * ⚠️ SEQUENTIAL, NOT Promise.all. Each upload counts the rows already on the
   * application against the cap and writes a new one; firing them together
   * would let three reads see the same count.
   *
   * ⚠️ AND THE PACK IS RE-READ AFTERWARDS. A document can satisfy a checklist
   * row and fill several answers, so the coverage rail and the pack list are
   * both stale the moment one lands. Re-reading is what makes the 271 meter
   * move while somebody watches.
   */
  const addFiles = useCallback(
    async (kind: string, files: File[]) => {
      setBusyKind(kind);
      setUploadErr(null);
      try {
        // ⚠️ THE RETURN VALUE IS THE POINT. This line read
        // `await motivationsApi.addUpload(...)` with no assignment, so every
        // reading we paid Vision and Claude for was discarded before it
        // reached anybody. The server will not write suggestions into answers
        // itself — deliberately, because a misread digit would become a false
        // statement on a signed form — so if the client drops them, the
        // extraction never happened as far as the member is concerned.
        let read: Suggestion[] = [];
        for (const file of files) {
          const added = await motivationsApi.addUpload(token, id, kind, file);
          // mergeReads: one line per field, last read wins — two photographs
          // of the same card must not offer two contradictory lines.
          read = mergeReads(read, added.suggestions ?? []);
        }
        const [p, d] = await Promise.all([
          motivationsApi.pack(token, id),
          motivationsApi.get(token, id),
        ]);
        setPack(p);
        setMissingRequired(d.missingRequired ?? []);
        // ⚠️ ONLY WHAT IS STILL EMPTY. A document that reads a serial must not
        // overwrite one the member typed and corrected — MEMBER always wins,
        // the same rule the provenance spine enforces server-side.
        setAnswers((cur) => {
          const next = { ...cur };
          for (const [k, v] of Object.entries(d.answers ?? {})) {
            if (!(next[k] ?? '').trim() && v) next[k] = v;
          }
          return next;
        });

        // ⚠️ OFFERED, NEVER APPLIED. Everything read off the document goes to
        // ExtractionReview for the member to tick — including values for
        // boxes they have already filled, because a document disagreeing with
        // what somebody typed is exactly the case worth showing them. What we
        // must not do is overwrite silently, which is why nothing here
        // touches `answers`.
        if (read.length) setSuggestions(read);
        const up = await motivationsApi.uploads(token, id);
        setUploads(up.files);
        setPickable(up.kinds ?? []);
        setDocuments(up.documents);
        setSellerInvite(sellerConsentOffered(up.documents));
      } catch (ex) {
        setUploadErr(
          ex instanceof MotivationApiError
            ? ex.message
            : 'That upload did not work.',
        );
      } finally {
        setBusyKind(null);
      }
    },
    [id, token],
  );

  /**
   * Re-read everything a document action can change.
   *
   * ⚠️ THE PACK AND THE UPLOAD LIST GO TOGETHER. Removing a document changes
   * the checklist, the annexure lettering and the SAPS 271 meter, and a list
   * that refreshed on its own would leave the member looking at a coverage
   * figure for a pack that no longer exists.
   */
  /**
   * Add one file and hand back what the server made of it.
   *
   * ⚠️ RETURNS THE ROW, unlike addFiles which only needs the suggestions. The
   * bulk door has to know what each file was FILED AS to offer a correction —
   * that is the whole review queue — so it needs the AddedUpload itself.
   */
  const addOne = useCallback(
    async (kind: string, file: File) => {
      const added = await motivationsApi.addUpload(token, id, kind, file);
      if (added.suggestions?.length) {
        setSuggestions((cur) => mergeReads(cur, added.suggestions ?? []));
      }
      return added;
    },
    [id, token],
  );

  /**
   * What this member already has on file, and whether we are keeping it.
   *
   * Lifted from the old page. Two independent try/catches on purpose: a
   * library we cannot read costs a shortcut, not the ability to upload, and a
   * failed consent lookup costs the extra control, not the page.
   *
   * ⚠️ `keeping === false` IS NOT AN EMPTY LIBRARY. Telling somebody holding
   * twelve documents "nothing saved to reuse yet" — because they once told us
   * not to keep them — is simply untrue, which is why LibraryPicker takes the
   * flag rather than inferring it from the list being empty.
   */
  const loadLibrary = useCallback(async () => {
    try {
      const r = await motivationsApi.library(token, id);
      setLibrary(r.items);
    } catch {
      /* a shortcut, not the page */
    }
    try {
      setKeeping((await licenceCentreApi.consent(token)).keeping);
    } catch {
      /* same rule */
    }
  }, [token, id]);

  const refreshDocs = useCallback(async () => {
    const [p, up] = await Promise.all([
      motivationsApi.pack(token, id),
      motivationsApi.uploads(token, id),
    ]);
    setPack(p);
    setUploads(up.files);
    setPickable(up.kinds ?? []);
    setDocuments(up.documents);
    setSellerInvite(sellerConsentOffered(up.documents));
    // ⚠️ NOT a separate proficiency state here. This page reads the 117705
    // cover off pack.proficiency, which the refetch above already updated —
    // a second copy would be the stale-alert bug the old page had.
  }, [id, token]);

  /**
   * Run one document action, then refresh.
   *
   * Every action shares the same shape — grey the row, do the thing, re-read,
   * report — so they share the runner rather than four near-identical copies
   * that drift the first time one of them learns something.
   */
  const docAction = useCallback(
    async (uploadId: string, run: () => Promise<unknown>, failed: string) => {
      setDocBusy(uploadId);
      setUploadErr(null);
      try {
        await run();
        await refreshDocs();
      } catch (ex) {
        setUploadErr(ex instanceof MotivationApiError ? ex.message : failed);
      } finally {
        setDocBusy(null);
      }
    },
    [refreshDocs],
  );

  /**
   * Open one document, so "attached" can be checked rather than believed.
   *
   * ⚠️ NO 'noopener', AND THAT IS DELIBERATE — lifted verbatim from the old
   * page, which learned it the hard way. Per spec, window.open with noopener
   * returns NULL: the flag exists precisely to sever the handle. So the tab
   * opened blank and was never filled, and the fallback then navigated the
   * CURRENT window out from under the member. Safe to drop here in a way it
   * would not be for a foreign URL: this is a same-origin blob we mint
   * ourselves a line later, and `opener` is nulled anyway.
   */
  const viewUpload = useCallback(
    async (uploadId: string) => {
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
   * Accept the lines the member ticked, and only those.
   *
   * applyExtraction is what actually writes them — it runs the same
   * provenance spine the rest of the pipeline does, so an accepted value
   * arrives marked as read off a document rather than typed, and the
   * ReadResult pills downstream say so.
   */
  const acceptRead = useCallback(
    async (accepted: Record<string, string>) => {
      setBusyKind('__apply__');
      try {
        await motivationsApi.applyExtraction(token, id, accepted);
        const [p, d] = await Promise.all([
          motivationsApi.pack(token, id),
          motivationsApi.get(token, id),
        ]);
        setPack(p);
        setMissingRequired(d.missingRequired ?? []);
        // ⚠️ THE ACCEPTED VALUES WIN OVER THE RE-FETCH. The member said yes a
        // moment ago; a stale read of `answers` must not put the old value
        // back on screen and make the tick look like it did nothing.
        setAnswers((cur) => ({ ...cur, ...(d.answers ?? {}), ...accepted }));
        setSuggestions([]);
      } catch (ex) {
        setUploadErr(
          ex instanceof MotivationApiError
            ? ex.message
            : 'We could not save those just now.',
        );
      } finally {
        setBusyKind(null);
      }
    },
    [id, token],
  );

  /** A field key in the member's own words, for anything that names one. */
  const labelForKey = useCallback(
    (key: string) => fields.find((f) => f.key === key)?.label ?? key,
    [fields],
  );

  /**
   * Reuse a document already on file.
   *
   * ⚠️ NEVER OVER AN ANSWER THEY TYPED — and, since 2026-09-06, never into an
   * answer at all without being seen. This wrote every reading straight into
   * the empty boxes while an identical value photographed a minute earlier went
   * through ExtractionReview for confirmation: two doors, two different rules
   * about a value the member signs for. The dangerous half was this one, being
   * the silent one. Both route through the review now.
   *
   * ⚠️ THE LABEL AND THE SOURCE ARE FILLED IN HERE. The from-library response
   * carries `{key, value}` with the raw registry key as its label and no source
   * — enough for a silent write, not enough for a line somebody has to judge.
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
      const read = (row.suggestions ?? [])
        .filter((sg) => sg.value)
        .map((sg) => ({
          ...sg,
          label: labelForKey(sg.key),
          from: sg.from || item.title,
          // The document was read when it was first attached and its reading
          // has been stored ever since; nothing here disagrees with it. A
          // doubted line is one OUR checks flag, and this path has none.
          trusted: sg.trusted !== false,
        }));
      if (read.length) setSuggestions((cur) => mergeReads(cur, read));
      await Promise.all([
        refreshDocs().catch(() => undefined),
        loadLibrary().catch(() => undefined),
      ]);
    },
    [token, id, refreshDocs, loadLibrary, labelForKey],
  );

  /**
   * A document arrived from the member's phone.
   *
   * ⚠️ THIS USED TO BE `onFiles(kind, [])` — a call into the upload loop with
   * nothing to upload. It refreshed the lists, which is half the job, and then
   * fell out of the loop with an empty `read`: the suggestions are built INSIDE
   * the per-file loop, so a document the phone sent could never produce one.
   * The member watched their licence card land on the desktop and was then
   * asked to type everything printed on it.
   *
   * ⚠️ AND THE READING COMES BACK THROUGH THE VAULT, WHICH IS THE ONLY PLACE IT
   * IS REACHABLE FROM. The phone's own upload response carried the suggestions
   * — to the phone. Nothing on the server hands the desktop a stored reading
   * for an attached document (`reread` returns field KEYS and costs a fresh
   * vision call; the uploads list returns keys too). What it does do is copy
   * every upload into the Document Centre where consent allows, and the vault
   * offer serves VALUES with labels and their source. So we ask that, keep the
   * lines that would fill a box still empty, and put them through the same
   * review every other reading goes through. Where there is no consent to keep
   * documents there is nothing to offer, and the member types it — which is
   * exactly what happened before this existed.
   */
  const onScanArrived = useCallback(async () => {
    setUploadErr(null);
    try {
      const before = new Set(uploadsRef.current.map((u) => u.id));
      await refreshDocs();
      const [p, d, up] = await Promise.all([
        motivationsApi.pack(token, id),
        motivationsApi.get(token, id),
        motivationsApi.uploads(token, id),
      ]);
      setPack(p);
      setMissingRequired(d.missingRequired ?? []);
      await loadLibrary().catch(() => undefined);

      // The reading the phone made, fetched off each file it delivered.
      // Exact, and costs no vision call. The vault offer below stays as the
      // fallback for a document read before this endpoint existed.
      const fresh = up.files.filter((u) => !before.has(u.id));
      const readings = await Promise.all(
        fresh.map((u) => motivationsApi.readingFor(token, id, u.id)),
      );
      const fromFiles = readings
        .flatMap((r) => r.suggestions)
        .filter((sg) => sg.value && !(answersRef.current[sg.key] ?? '').trim())
        .map((sg) => ({
          key: sg.key,
          value: sg.value,
          label: labelForKey(sg.key),
          from: 'Read off your document',
          trusted: true,
        }));
      if (fromFiles.length) setSuggestions((cur) => mergeReads(cur, fromFiles));

      const offer = await motivationsApi.licenceCentreOffer(token, id);
      const have = new Set(fromFiles.map((x) => x.key));
      const read = offer.items
        .filter(
          (it) =>
            it.value &&
            !have.has(it.key) &&
            !(answersRef.current[it.key] ?? '').trim(),
        )
        .map((it) => ({
          key: it.key,
          value: it.value,
          label: labelForKey(it.key),
          from: it.from,
          trusted: true,
        }));
      if (read.length) setSuggestions((cur) => mergeReads(cur, read));
    } catch {
      // A refresh we could not finish costs the member a reload, never the
      // documents — they are on the server either way.
    }
  }, [token, id, refreshDocs, loadLibrary, labelForKey]);

  /**
   * Attach what the Document Centre already holds, once, without being asked.
   *
   * ⚠️ THE REF IS THE POINT. Effects re-run; a second autolink would attach
   * nothing (the server skips kinds already present) but would still cost a
   * round trip on every dependency change. Lifted from the old page.
   */
  const autolinkRan = useRef(false);
  useEffect(() => {
    if (autolinkRan.current || !allowed) return;
    autolinkRan.current = true;
    void (async () => {
      try {
        const res = await motivationsApi.autolink(token, id);
        if (!res.attached.length) return;
        setAutolinked(res.attached);
        // Everything downstream reads from these, so refresh rather than
        // patching the lists by hand and risking a disagreement.
        await refreshDocs();
      } catch {
        // Never costs the page. The member attaches by hand, as before.
      }
    })();
  }, [token, id, allowed, refreshDocs]);

  useEffect(() => {
    if (allowed) void loadLibrary();
  }, [allowed, loadLibrary]);

  /**
   * Answer one of Boet's questions.
   *
   * The reply is merged server-side into the answers under the question's own
   * fieldKey, so the local answers have to be re-read rather than patched —
   * and the status moves back off NEEDS_MORE_INFO once nothing is outstanding.
   */
  const answerFollowUp = useCallback(
    async (messageId: string, text: string) => {
      try {
        await motivationsApi.answerFollowUp(token, id, messageId, text);
        const [d, m, p] = await Promise.all([
          motivationsApi.get(token, id),
          motivationsApi.messages(token, id),
          motivationsApi.pack(token, id),
        ]);
        setAnswers((cur) => ({ ...cur, ...(d.answers ?? {}) }));
        setMissingRequired(d.missingRequired ?? []);
        setMessages(m);
        setPack(p);
      } catch (ex) {
        setUploadErr(
          ex instanceof MotivationApiError
            ? ex.message
            : 'We could not save that answer.',
        );
      }
    },
    [id, token],
  );

  /**
   * What is still unanswered, RIGHT NOW.
   *
   * ⚠️ THE SERVER'S LIST IS A SNAPSHOT AND IT CAN ONLY SHRINK. This screen
   * trusted `missingRequired` alone, and requiredKeys() on the server is
   * answer-DEPENDENT: answering "Married" makes spouse_id_number required by a
   * rule that was not even visible when the page loaded. Crossing items off a
   * load-time list can never add those, so the wizard showed nothing
   * outstanding, opened the Generate door, and the server refused with "Some
   * required answers are still missing" — spending one of a small hourly quota
   * per doomed press. The same union the live wizard computes, for the same
   * reason.
   */
  const outstanding = useMemo(() => {
    const empty = (k: string) => !(answers[k] ?? '').trim();
    const live = visibleFields(fields, answers)
      .filter((f) => f.required && empty(f.key))
      .map((f) => f.key);
    // UNION, never replacement: the server may require something on registry
    // logic this component does not evaluate. Over-reporting shows a box to
    // fill; under-reporting is the dead end above.
    return Array.from(new Set([...missingRequired.filter(empty), ...live]));
  }, [missingRequired, answers, fields]);

  const missing = useMemo(() => new Set(outstanding), [outstanding]);

  /**
   * Required DOCUMENTS still outstanding.
   *
   * ⚠️ SERVED, AND RE-FILTERED THROUGH WHAT IS ACTUALLY USABLE. The server's
   * list says what is required; only the row knows an attached certificate has
   * expired or lost its Document Centre source. Taking the served list alone
   * would let an expired competency certificate open the Generate door the
   * attached list has already gone amber over — the two halves of one screen
   * disagreeing about the same document.
   */
  const missingDocs = useMemo(() => {
    const served = documents?.missingRequired ?? [];
    const unmet = (documents?.needs ?? [])
      .filter((n) => n.tier === 'required')
      .filter((n) => {
        const files = uploads.filter((u) => u.kind === n.kind);
        return !(n.have && (files.length === 0 || files.some(usableUpload)));
      })
      .map((n) => n.kind);
    return Array.from(new Set([...served, ...unmet]));
  }, [documents, uploads]);

  /** An upload kind as the member knows it — never the raw SCREAMING_CASE. */
  const documentLabelFor = useCallback(
    (kind: string) =>
      documents?.needs.find((n) => n.kind === kind)?.label ??
      pickable.find((k) => k.kind === kind)?.label ??
      kind,
    [documents, pickable],
  );

  // ⚠️ `step` INDEXES THE WALK, NOT THE RAIL. An application walks ten steps;
  // the rail draws eleven, because the section was chosen on a screen before
  // this one existed. Everything the member SEES is a display index and goes
  // through toDisplayIndex; everything that picks a question or a document is
  // a walked index. See wizard-rail.tsx — both are `number` and nothing in the
  // types will catch a swap.
  const steps = APPLICATION_STEPS;
  const current = steps[Math.min(step, steps.length - 1)];
  const last = step === steps.length - 1;

  /** Which registry sections still hold an outstanding answer. Feeds the rail. */
  const outstandingSections = useMemo(() => {
    const keys = new Set(outstanding);
    return Array.from(
      new Set(fields.filter((f) => keys.has(f.key)).map((f) => f.section)),
    );
  }, [outstanding, fields]);

  /**
   * Go to a step, and say so in the URL.
   *
   * ⚠️ AND SCROLL TO THE TOP. One panel is visible at a time on a page that can
   * be several screens long; changing step from the footer left the member
   * looking at the bottom of the next step, which reads as a button that did
   * nothing.
   */
  const goStep = useCallback(
    (next: number) => {
      const n = Math.max(0, Math.min(APPLICATION_STEPS.length - 1, next));
      setStep(n);
      const key = APPLICATION_STEPS[n]?.key;
      if (key) {
        window.history.replaceState(null, '', `#${key}`);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [],
  );

  /** Which step asks a given field, so a name can be jumped to. */
  const stepForKey = useCallback(
    (key: string) => {
      const section = fields.find((f) => f.key === key)?.section;
      if (!section) return null;
      const at = APPLICATION_STEPS.findIndex((s) =>
        (s.sections ?? []).includes(section),
      );
      return at < 0 ? null : at;
    },
    [fields],
  );

  /** Which step asks for a given document. */
  const stepForKind = useCallback((kind: string) => {
    const at = APPLICATION_STEPS.findIndex((s) =>
      (s.documents ?? []).some((d) => d.kind === kind),
    );
    return at < 0 ? null : at;
  }, []);

  if (!allowed) return null;

  if (loading) {
    return (
      <main className="px-4 py-8 sm:px-6">
        <p className="text-sm text-[var(--text-secondary)]">
          Opening your application…
        </p>
      </main>
    );
  }

  if (error || !pack) {
    return (
      <main className="px-4 py-8 sm:px-6">
        <div className="rounded-[var(--r-md)] border border-[var(--border)] p-4">
          <p className="text-sm text-[var(--text-primary)]">
            {error ?? 'We could not open this application.'}
          </p>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Your answers are safe.{' '}
            <Link href={`/motivations/${id}`} className="underline">
              Open the classic view
            </Link>{' '}
            to carry on.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── the chrome bar ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3.5 border-b border-[var(--border)] px-4 py-3 sm:px-6">
        <div className="text-[12.5px] text-[var(--text-tertiary)]">
          Licence services /{' '}
          <span className="font-medium text-[var(--text-secondary)]">
            {pack.referenceNumber} — {LICENCE_SECTION[pack.licenceType] ?? ''},{' '}
            {licenceLabel(pack.licenceType).toLowerCase()}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4 text-[12px] text-[var(--text-tertiary)]">
          <SaveState state={autosave.state} refused={autosave.refused} />
          {/* ⚠️ IN THE CHROME BAR BECAUSE THE CHROME BAR IS THE ONLY THING ON
              EVERY STEP. Operator: "put a visible option that is visible
              everywhere for user to delete the application." The old page put
              it under a divider at the bottom of a very long scroll and the
              rebuilt one had it nowhere at all — somebody who started an
              application by mistake could not get rid of it. */}
          <DeleteApplication
            token={token}
            motivationId={id}
            reference={pack.referenceNumber}
          />
        </div>
      </div>

      {/* The whole journey, including the part that happened before this
          screen — ticked, and not a way back: the choice it recorded cannot be
          changed, and the chrome bar above already restates it. */}
      {/* ⚠️ THE TICKS ARE DERIVED, NOT POSITIONAL. The rail used to go green
          for every step LEFT BEHIND, so clicking ahead to type one number
          ticked four empty steps — and the step being worked on could never
          tick however much went into it. See stepDone in wizard-rail.tsx. */}
      <WizardRail
        steps={WIZARD_STEPS}
        current={toDisplayIndex(step)}
        lockedBefore={DISPLAY_OFFSET}
        outstandingSections={outstandingSections}
        outstandingKinds={missingDocs}
        onGo={(i) => {
          const walked = toWalkedIndex(i);
          if (walked !== null) goStep(walked);
        }}
      />

      {!PACK_SCREEN_SHIPPED && (
        <div
          className="border-b px-4 py-2 sm:px-6"
          style={{
            borderColor: 'var(--gold-line)',
            background: 'var(--gold-wash)',
          }}
        >
          <p className="text-[12.5px] text-[var(--text-primary)]">
            <span className="font-medium">Preview.</span> Still being built —
            you cannot upload or scan documents from here yet.{' '}
            <Link href={`/motivations/${id}`} className="underline">
              Classic view
            </Link>{' '}
            ·{' '}
            <button
              type="button"
              onClick={() => {
                clearPreviewOptIn();
                window.location.href = `/motivations/${id}`;
              }}
              className="underline"
            >
              Leave preview
            </button>
          </p>
        </div>
      )}

      {/* ── body: the step, and the 271 beside it on every step ── */}
      <div className="grid flex-1 grid-cols-1 gap-[26px] px-4 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[.11em] text-[var(--text-tertiary)]">
              {/* ⚠️ THE DISPLAY NUMBER, NOT THE WALKED ONE. The firearm is the
                  first step an application walks and the SECOND the member
                  counts — they chose a section to get here, and telling them
                  that was step nothing would be a lie about their own
                  progress. */}
              Step {toDisplayIndex(step) + 1} of {WIZARD_STEPS.length} ·{' '}
              {current.fills}
            </div>
            <h1 className="mb-1.5 mt-1.5 text-[26px] font-medium tracking-[-.02em] text-[var(--text-primary)]">
              {current.title}
            </h1>
            <p className="max-w-[78ch] text-[14.5px] text-[var(--text-secondary)]">
              {current.blurb}
            </p>
          </div>

          {/* On the step this visit STARTED on — see entryStep. */}
          {step === entryStep && (
            <PrefillBanner
              prefill={pack.prefill}
              provenance={pack.provenance}
            />
          )}

          {uploadErr && (
            <p className="text-[13px] text-[var(--red)]">{uploadErr}</p>
          )}

          {/* ⚠️ ABOVE THE STEP BODY, NOT INSIDE A STEP. A licence
              photographed from "Firearms you already own" can read a value
              that belongs to "The firearm" — and the old page learned this
              the hard way, having put the panel inside the documents step so
              a member had to guess that accepting meant navigating back. What
              disagrees with what they typed has to be answerable wherever
              they are standing. */}
          {/* ⚠️ SAY WHAT WE TOOK, AND THAT IT CAN BE REMOVED. Attaching
              documents without being asked is only acceptable if the member
              is told which ones — silence would be us adding things to a pack
              they sign, out of sight. */}
          {autolinked.length > 0 && (
            <div
              className="gg-tile rounded-[8px] border px-4 py-3"
              style={{
                borderColor: 'var(--success-line)',
                background: 'var(--success-wash)',
              }}
            >
              <p className="text-[13px] font-medium">
                We added {autolinked.length}{' '}
                {autolinked.length === 1 ? 'document' : 'documents'} from your
                Document Centre
              </p>
              <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">
                {autolinked.map((a) => a.title).join(', ')}. Remove any of them
                on the step that asks for it.
              </p>
              <button
                type="button"
                onClick={() => setAutolinked([])}
                className="mt-1.5 min-h-[44px] px-1 text-[12px] underline underline-offset-2"
              >
                Got it
              </button>
            </div>
          )}

          {/* Above the step body with the other things that block progress:
              a question holding the document back must be answerable from
              wherever the member happens to be standing. */}
          <FollowUpThread messages={messages} onAnswer={answerFollowUp} />

          <ExtractionReview
            suggestions={suggestions}
            busy={busyKind !== null}
            onAccept={acceptRead}
            onDismiss={() => setSuggestions([])}
          />

          {/* ⚠️ MOUNTED ON EVERY STEP, SHOWN ON ONE, AND THAT IS THE FIX. It
              lived inside the step body, so changing step mid-upload unmounted
              it: the upload carried on server-side while its review queue —
              what we filed each document as, the only place a human is asked to
              confirm it — was destroyed with the component. The Document Centre
              lost six licences to the same shape of bug, and `filed` is
              component state precisely because the page below owns nothing
              about it.

              ⚠️ AND IT HAS TO BE THE FIRST THING ON THE FIRST STEP. Every
              capture card is bound to one kind, so a member has to know what
              each scan is before they can hand it over; this is the way out of
              that. `entryStep === 0 ? 0 : 0` would be wrong — it belongs on the
              first step an application walks, not on whichever one somebody
              happens to land on. */}
          <div className={step === 0 ? 'max-w-[800px]' : 'hidden'}>
            <BulkCapture
              pickable={pickable}
              onAdd={addOne}
              onRefile={(uid, kind) =>
                docAction(
                  uid,
                  () => motivationsApi.refileUpload(token, id, uid, kind),
                  'We could not change that document type.',
                )
              }
            />
          </div>

          <StepBody
            stepKey={current.key}
            sections={current.sections}
            documents={current.documents}
            uploads={uploads}
            pickable={pickable}
            docBusy={docBusy}
            onView={viewUpload}
            onRemove={(uid) =>
              docAction(
                uid,
                () => motivationsApi.removeUpload(token, id, uid),
                'We could not remove that document.',
              )
            }
            onReread={(uid) =>
              docAction(
                uid,
                () => motivationsApi.rereadUpload(token, id, uid),
                'We could not read that document again.',
              )
            }
            onRefile={(uid, kind) =>
              docAction(
                uid,
                () => motivationsApi.refileUpload(token, id, uid, kind),
                'We could not change that document type.',
              )
            }
            library={library}
            keeping={keeping}
            token={token}
            onPickFromLibrary={attachFromLibrary}
            sellerInvite={sellerInvite}
            outstanding={outstanding}
            outstandingLabel={labelForKey}
            missingDocuments={missingDocs}
            documentLabel={documentLabelFor}
            onGoToAnswer={(key) => {
              const at = stepForKey(key);
              if (at !== null) goStep(at);
            }}
            onGoToDocuments={(kind) => {
              const at = stepForKind(kind);
              if (at !== null) goStep(at);
            }}
            onArrived={onScanArrived}
            saps271Filled={(answers[SAPS271_OPT_KEY] ?? '') === SAPS271_FILL}
            onGenerated={(st) => {
              // The pack step re-reads everything: a finished document changes
              // the checklist, the coverage meter and the status chip at once.
              setPack((cur) => (cur ? { ...cur, status: st } : cur));
              void refreshDocs();
            }}
            onVaultApplied={(filled, missingNow) => {
              // ⚠️ THE APPLICANT'S OWN EDITS WIN over what arrives, the same
              // rule the document reading follows. A vault value must never
              // overwrite something they typed and corrected.
              setAnswers((cur) => ({ ...filled, ...cur }));
              setMissingRequired(missingNow);
            }}
            motivationId={id}
            busyKind={busyKind}
            onFiles={addFiles}
            pack={pack}
            fields={fields}
            answers={answers}
            missing={missing}
            onChange={setAnswer}
            openRow={openRow}
            onToggleRow={(k) => setOpenRow((cur) => (cur === k ? null : k))}
          />
        </div>

        <Saps271Meter coverage={pack.coverage} />
      </div>

      {/* ── footer ──────────────────────────────────────────────── */}
      {/* ⚠️ STICKY, NOT STATIC. The mockup pins this bar because its frame is a
          fixed 1080px with overflow:hidden; a real page scrolls, and a Continue
          button that scrolls away is a wizard somebody gets stuck in. */}
      <div className="sticky bottom-0 z-10 mt-6 flex items-center gap-3.5 border-t border-[var(--border)] bg-[var(--bg-card)] px-4 py-[15px] sm:px-6">
        <button
          type="button"
          onClick={() => goStep(step - 1)}
          disabled={step === 0}
          className="min-h-[44px] rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-5 py-[11px] text-[13.5px] font-medium text-[var(--text-secondary)] disabled:opacity-40"
        >
          Back
        </button>
        <div className="flex-1 text-[12.5px] text-[var(--text-tertiary)]">
          {/* ⚠️ THE HINT IS DERIVED, NEVER A HARDCODED SENTENCE PER STEP. The
              mockup's HINTS array is nine written lines because it is a
              picture; on a real application the only honest hint is what this
              member still has outstanding. */}
          {hintFor(current.sections, fields, missing)}
        </div>
        <button
          type="button"
          onClick={() =>
            // ⚠️ THE LAST STEP IS A DESTINATION, NOT A HANDOFF. This read
            // `router.push('/motivations/${id}')` — the single clearest proof
            // the rebuilt wizard could not stand alone. The pack step now
            // finishes the document itself; the button simply stops.
            last ? undefined : goStep(step + 1)
          }
          disabled={last}
          className="min-h-[44px] rounded-[var(--r-sm)] border-0 bg-[var(--red)] px-6 py-[11px] text-[13.5px] font-medium text-white"
        >
          {last ? 'Your pack' : 'Continue'}
        </button>
      </div>
    </div>
  );
}


/**
 * Does the pack offer to invite the seller?
 *
 * The server decides this — it sets the flag on the source-proof row only on
 * a private sale — and reading it rather than re-deriving from the answer
 * means the wizard and the checklist cannot disagree about which route
 * somebody is on.
 */
function sellerConsentOffered(d: DocumentStatus | undefined): boolean {
  return (d?.needs ?? []).some(
    (n) => n.kind === 'FIREARM_SOURCE_PROOF' && n.sellerConsent === true,
  );
}

/** What each step actually asks. */
function StepBody({
  stepKey,
  sections,
  documents,
  motivationId,
  busyKind,
  uploads,
  pickable,
  docBusy,
  library,
  keeping,
  token,
  onPickFromLibrary,
  onVaultApplied,
  outstanding,
  outstandingLabel,
  missingDocuments,
  documentLabel,
  onGoToAnswer,
  onGoToDocuments,
  onArrived,
  saps271Filled,
  onGenerated,
  sellerInvite,
  onView,
  onRemove,
  onReread,
  onRefile,
  onFiles,
  pack,
  fields,
  answers,
  missing,
  onChange,
  openRow,
  onToggleRow,
}: {
  stepKey: string;
  sections?: string[];
  documents?: { kind: string; title: string; subtitle?: string }[];
  motivationId: string;
  busyKind: string | null;
  onFiles: (kind: string, files: File[]) => void;
  uploads: UploadRow[];
  pickable: PickableKind[];
  docBusy: string | null;
  library: LibraryItem[];
  keeping: boolean | undefined;
  token: TokenGetter;
  onPickFromLibrary: (item: LibraryItem, placeConfirmed?: boolean) => Promise<void>;
  onVaultApplied: (filled: Record<string, string>, missing: string[]) => void;
  outstanding: string[];
  outstandingLabel: (key: string) => string;
  /** Required documents still outstanding — they block Generate too. */
  missingDocuments: string[];
  documentLabel: (kind: string) => string;
  onGoToAnswer: (key: string) => void;
  onGoToDocuments: (kind: string) => void;
  /** A document landed from the member's phone. */
  onArrived: () => void;
  saps271Filled: boolean;
  onGenerated: (status: string) => void;
  sellerInvite: boolean;
  onView: (id: string) => void;
  onRemove: (id: string) => void;
  onReread: (id: string) => void;
  onRefile: (id: string, kind: string) => Promise<void>;
  pack: MotivationPack;
  fields: MotivationField[];
  answers: Record<string, string>;
  missing: Set<string>;
  onChange: (key: string, value: string) => void;
  openRow: string | null;
  onToggleRow: (key: string) => void;
}) {
  // ⚠️ THERE IS NO 'section' BRANCH ANY MORE, AND ITS ABSENCE IS THE POINT.
  //
  // It restated the licence type under the heading "Step 1 of 11" — the same
  // number the chooser at /licence-services/new had just used, saying what the
  // chrome bar says on every single step. Operator, 2026-08-30: "remove step1
  // out of the process… essentially Step2 on the frontend is step 1 in the
  // backend." APPLICATION_STEPS is that ten; the rail still draws eleven.
  //
  // The choice itself remains unchangeable — `Motivation.licenceType` is
  // written exactly once, by create(), and no route can change it. The field
  // registry, the checklist, the 271 box mapping, the eligibility blockers and
  // the generator's legal framing are each a pure function of it, and every
  // saved answer was already filtered through `sanitiseAnswers(licenceType)`.
  // A selector here would not be a harder version of that panel; it would be a
  // silent data-loss bug wearing a dropdown.

  // The last step is the pack itself: what we produce, what you gather, and
  // what somebody else has to send.
  if (stepKey === 'pack') {
    return (
      <div className="max-w-[820px] space-y-6">
        {/* ⚠️ THE WIZARD FINISHES HERE NOW. This step used to be a read-only
            checklist whose only action was a button that navigated to the old
            page — a member walked eleven steps in the new design and was
            handed back to the old one to actually get their document. */}
        <PackFinish
          token={token}
          motivationId={motivationId}
          reference={pack.referenceNumber}
          status={pack.status}
          outstanding={outstanding}
          outstandingLabel={outstandingLabel}
          onGoToAnswer={onGoToAnswer}
          missingDocuments={missingDocuments}
          documentLabel={documentLabel}
          onGoToDocuments={onGoToDocuments}
          saps271Filled={saps271Filled}
          onStatus={onGenerated}
        />

        {pack.checklist.sections.map((s) => (
          <PackGroup
            key={s.key}
            section={s}
            expandedKey={openRow}
            onToggle={onToggleRow}
          />
        ))}
      </div>
    );
  }

  // "Where it is from" has no registry section of its own — the routing
  // question lives in "The firearm" and the seller's half is his to complete.
  if (stepKey === 'source') {
    // ⚠️ THIS STEP USED TO BE A PARAGRAPH SAYING "send it from the classic
    // view for now" — an explicit handoff to the page we are deleting, on the
    // one step whose entire job is to reach somebody else. The module was
    // built, worked end to end, and simply had no mount here.
    if (!sellerInvite) {
      return (
        <div className="gg-tile max-w-[820px] rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] px-[17px] py-[15px]">
          <p className="text-[13.5px] text-[var(--text-secondary)]">
            You told us this firearm is coming from a dealer, so there is
            nothing to send. Your dealer completes his own part of the
            paperwork at the counter and holds the firearm until your licence
            is granted.
          </p>
        </div>
      );
    }
    return (
      <div className="max-w-[820px]">
        <MotivationSellerConsent
          motivationId={motivationId}
          applicantName={answers.full_name ?? ''}
          firearm={{
            firearm_type: answers.firearm_type,
            firearm_make: answers.firearm_make,
            firearm_model: answers.firearm_model,
            firearm_calibre: answers.firearm_calibre,
            firearm_serial: answers.firearm_serial,
          }}
          // ⚠️ THROUGH THE PAGE'S OWN ANSWERS, NEVER A DIRECT API WRITE. The
          // wizard autosaves what it holds in memory, so a value written to
          // the server behind its back is overwritten by the very next save.
          // The component's own prop doc says so; this is the honouring of it.
          onAdopt={(fields) => {
            for (const [k, v] of Object.entries(fields)) onChange(k, v);
          }}
        />
      </div>
    );
  }

  const stepFields = (sections ?? []).flatMap((sec) =>
    visibleFields(fields, answers).filter((f) => f.section === sec),
  );

  return (
    <div className="max-w-[800px] space-y-4">
      {/* The bulk door — "send us the whole folder" — is mounted by the PAGE
          now, so changing step mid-upload cannot unmount it and take its review
          queue with it. See the note at its mount site. */}

      {/* SURFACE TWO OF TWO. Operator, asked where the 117705 alert belongs:
          "alert appears on both." Here it sits ABOVE the capture cards, so a
          member who is about to photograph one certificate is told, before
          they start, that the pack also needs the page from their first
          course. Below the cards it would be advice arriving after the act. */}
      {stepKey === 'competency' && (
        <ProficiencyAlert cover={pack.proficiency} />
      )}

      {/* ⚠️ WHAT THE DOCUMENT CENTRE COULD FILL, ON THE STEP THAT ASKS IT.
          Prefixes lifted from the old page along with what they cost to get
          wrong: the dedicated-status half never rendered for months because
          the panel was mounted on "About you" and handed `association_`,
          while those fields live in their own section — so the offer computed
          the values, shipped them to the browser, and filtered every one out
          against a section that could not contain them. Silent since the day
          it was written. Here the step OWNS its prefixes, so the two cannot
          drift apart. */}
      {VAULT_PREFIXES[stepKey] && (
        <LicenceCentreOfferPanel
          token={token}
          motivationId={motivationId}
          keyPrefixes={VAULT_PREFIXES[stepKey]!}
          onApplied={onVaultApplied}
        />
      )}

      {/* ⚠️ WHAT THEY ALREADY GAVE US, BEFORE THE CAMERA. A member arriving
          at a step they have half-finished should see the document sitting
          there, not an empty camera implying nothing was attached — and the
          only way to correct a wrong file is to be shown it. */}
      <AttachedDocuments
        documents={uploads}
        kinds={(documents ?? []).map((d) => d.kind)}
        pickable={pickable}
        busyId={docBusy}
        onView={onView}
        onRemove={onRemove}
        onReread={onReread}
        onRefile={onRefile}
        // ⚠️ ONLY REACHABLE FROM A ROW WHOSE SOURCE IS GONE. The camera for
        // this kind is a few inches below, so the link simply takes them to it
        // rather than opening a second door.
        onReplace={(kind) =>
          document
            .getElementById(`capture-${kind}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      />

      {/* Capture first — photographing the document is what fills the page. */}
      {documents?.map((d) => (
        <div key={d.kind} id={`capture-${d.kind}`}>
          <CaptureCards
            motivationId={motivationId}
            kind={d.kind}
            title={d.title}
            subtitle={d.subtitle}
            busy={busyKind !== null}
            onFiles={(files) => onFiles(d.kind, files)}
            // ⚠️ NOT `onFiles(kind, [])`. That called the upload loop with
            // nothing to upload: it refreshed the lists and could never produce
            // a suggestion, because they are built inside the per-file loop. A
            // member watched their licence card arrive from their phone and was
            // then asked to type everything printed on it. See onScanArrived.
            onArrived={onArrived}
          />
        </div>
      ))}

      {/* ⚠️ "USE ONE I ALREADY HAVE" — the reuse half of the Document Centre,
          which the rebuilt wizard could not reach at all. One picker per
          document this step asks for, narrowed to that kind: a member should
          never be shown their ID as an option under "your proof of address".
          It renders even when empty, disabled and saying so — returning null
          is invisible, and invisible is indistinguishable from never built. */}
      {(documents ?? []).map((d) => (
        <LibraryPicker
          key={`lib-${d.kind}`}
          items={library.filter((i) => i.kind === d.kind)}
          keeping={keeping}
          onPick={onPickFromLibrary}
        />
      ))}

      {/* ⚠️ EACH STEP GETS THE ARTBOARD'S OWN BLOCK, NOT ONE GENERIC PANEL.
          The design uses a different shape per step for a reason: a document
          being read is a review with confidence pills; a settled list of
          facts is a two-column grid; six questions nobody can prefill are
          six visible yes/no pairs; owned firearms are collapsible cards. One
          panel for all of them is the thing that made the live screen look
          nothing like the design. */}
      {stepKey === 'owned' ? (
        // Collapsible per-firearm cards, and the row rule that shows the LAST
        // row in use rather than a count of how many — see
        // lib/owned-firearm-rows.ts and the bug its spec records.
        <PackSection
          title=""
          section="Firearms you already own"
          fields={fields}
          answers={answers}
          missing={missing}
          onChange={onChange}
        />
      ) : stepKey === 'declarations' ? (
        // ⚠️ VISIBLE PILL PAIRS, AND NOTHING PRE-SELECTED. The artboard draws
        // all six answered "No" because it is a picture of a finished
        // application; shipping that would put words about somebody's
        // criminal record in their mouth, on a form signed under s 120(9)(f).
        <div className="divide-y divide-[var(--border-divider)]">
          {stepFields.map((f) =>
            f.kind === 'yesno' ? (
              <YesNoPills
                key={f.key}
                field={f}
                value={answers[f.key] ?? ''}
                missing={missing.has(f.key)}
                onChange={(v) => onChange(f.key, v)}
              />
            ) : (
              <div key={f.key} className="py-2.5">
                <FieldInput
                  field={f}
                  value={answers[f.key] ?? ''}
                  missing={missing.has(f.key)}
                  onChange={(v) => onChange(f.key, v)}
                />
              </div>
            ),
          )}
        </div>
      ) : stepKey === 'about' || stepKey === 'case' ? (
        // A settled list of facts, two columns, sensitive values masked while
        // collapsed and shown while being corrected.
        <FieldGrid
          fields={stepFields}
          answers={answers}
          provenance={pack.provenance}
          missing={missing}
          onChange={onChange}
        />
      ) : stepFields.length > 0 ? (
        // A document being read: every line with where its value came from.
        <ReadResult
          stepKey={stepKey}
          section={(sections ?? [])[0] ?? ''}
          fields={stepFields}
          answers={answers}
          provenance={pack.provenance}
          missing={missing}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

/**
 * What is still outstanding on this step, counted rather than written.
 *
 * ⚠️ COUNTS ONLY WHAT IS REQUIRED AND STILL EMPTY, from the server's own
 * missingRequired. A hint invented on the client would drift from the gate
 * that actually decides whether a pack can be produced.
 */
function hintFor(
  sections: string[] | undefined,
  fields: MotivationField[],
  missing: Set<string>,
): string {
  if (!sections?.length) return '';
  const mine = fields.filter(
    (f) => sections.includes(f.section) && missing.has(f.key),
  );
  if (!mine.length) return 'Nothing outstanding here.';
  return mine.length === 1
    ? 'One answer still needed.'
    : `${mine.length} answers still needed.`;
}

function SaveState({ state, refused }: { state: string; refused: string[] }) {
  if (refused.length > 0) {
    return (
      <span className="text-[var(--warning)]">
        Not saved — please tell support
      </span>
    );
  }
  if (state === 'saving') return <span>Saving…</span>;
  if (state === 'saved') return <span>Saved a moment ago</span>;
  if (state === 'error') return <span>Not saved</span>;
  return null;
}
