'use client';

import { useState, type ReactNode } from 'react';
import type { CredentialSlot, SheetCredentials } from './contract';

// ────────────────────────────────────────────────────────────────────
// COMPETENCY AND PROFICIENCY, WITH SOMEWHERE TO GO.
//
// Operator, 2026-09-08, having asked twice: "there still is no proficiency
// section with the links I asked for twice already, why???"
//
// The honest answer is that both earlier asks were answered SERVER-SIDE —
// motivation-autolink's enforcePair attaches the two together and refuses one
// without the other — and a rule with no surface is a rule nobody can see. The
// competency section rendered four ANSWERS (number, covers, issued, expiry)
// and never mentioned the two DOCUMENTS behind them, so a member who had never
// uploaded a statement of results saw a section that looked finished.
//
// ⚠️ SO THIS IS ABOUT DOCUMENTS, NOT ANSWERS, and it sits under the answers
// rather than replacing them. CompetencyLines still renders what we read OFF
// the certificate; this says whether the certificate itself is in the pack.
//
// ⚠️ THREE DOORS PER SLOT, IN THE ORDER THAT COSTS THE MEMBER LEAST: what they
// have already given us, then the camera, then a file. The Licence Centre door
// only appears when there is something behind it — a disabled control over an
// empty list is what made the operator ask for this control three times while
// looking straight at it.
//
// ⚠️ THE PAIR NOTE IS THE POINT. Everything else here a member could work out
// from the shelf; that sentence is the one that tells them the half they hold
// is not enough. It is AMBER, never red — a document to fetch is not a mistake
// they have made.
// ────────────────────────────────────────────────────────────────────

export interface CredentialPairProps {
  credentials: SheetCredentials;
  /** Open the phone/desktop scanner. */
  onScan: () => void;
  /** Files chosen from the operating system. */
  onUpload: (files: File[]) => void;
  /**
   * Open the reuse picker for one kind.
   *
   * ⚠️ THE PAGE FETCHES THE LIST, NOT THIS. `GET :id/library` folds a two-page
   * proficiency into one entry and hides what is already attached; the sheet
   * carries only a count, so this asks and the page answers.
   */
  onAddFromCentre: (kind: CredentialSlot['kind']) => void;
  /**
   * The reuse control, once the page has fetched the list, and which slot it
   * belongs under.
   *
   * ⚠️ BUILT BY THE PAGE, RENDERED HERE. LibraryPicker needs the library, the
   * consent state and the attach call — three things this file is not allowed
   * to hold (see contract.ts: the page is the only stateful file). Passing the
   * finished control in keeps that rule and still lands it under the right
   * document instead of at the bottom of the section.
   */
  picker?: { kind: CredentialSlot['kind']; node: ReactNode } | null;
}

function Held({
  letter,
  origin,
  unread,
}: {
  letter: string | null;
  origin: 'vault' | 'member';
  unread: boolean;
}) {
  return (
    <div className="mt-[6px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-[1.35]">
      <span className="inline-flex items-center gap-[5px] text-[var(--success)]">
        <span aria-hidden="true">✓</span>
        In your pack
      </span>
      {letter ? (
        <span className="text-[var(--text-tertiary)]">Annexure {letter}</span>
      ) : null}
      {/*
        ⚠️ THE SAME TWO WORDS THE SHELF USES. A member is told where a document
        came from in one vocabulary wherever it appears — operator, 2026-09-08:
        "indicate where a document origin is from, Added by License centre or
        User added."
      */}
      <span className="text-[var(--text-tertiary)]">
        {origin === 'vault' ? 'from your Licence Centre' : 'you added it here'}
      </span>
      {/*
        Gold, never red. A page we could not read is still attached and still
        goes in the pack — the same rule as the shelf's `check` state.
      */}
      {unread ? (
        <span className="text-[var(--gold-strong)]">we could not read it</span>
      ) : null}
    </div>
  );
}

function Slot({
  slot,
  onScan,
  onUpload,
  onAddFromCentre,
  picker,
}: {
  slot: CredentialSlot;
} & Omit<CredentialPairProps, 'credentials'>) {
  const [id] = useState(
    () => `pair-file-${slot.kind.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const have = slot.held.length > 0;

  return (
    <div className="border-b border-[var(--border-divider)] py-[12px] last:border-b-0">
      <div className="text-[14px] font-medium leading-[1.3] text-[var(--text-primary)]">
        {slot.label}
      </div>
      <p className="m-0 mt-[2px] text-[12.5px] leading-[1.4] text-[var(--text-secondary)]">
        {slot.blurb}
      </p>

      {have ? (
        slot.held.map((h, i) => <Held key={i} {...h} />)
      ) : (
        <div className="mt-[8px] flex flex-wrap gap-[6px]">
          {/*
            ⚠️ ONLY WHEN THERE IS SOMETHING BEHIND IT. A door onto an empty
            list teaches a member that the feature does not work, and the
            picker itself already says "nothing saved yet" for the surfaces
            that must show it disabled. Here, absence is the honest answer.
          */}
          {slot.inCentre > 0 ? (
            <button
              type="button"
              onClick={() => onAddFromCentre(slot.kind)}
              className="min-h-[38px] rounded-[var(--r-sm)] border border-[var(--red-line)] bg-[var(--red-wash)] px-[12px] text-[13px] font-medium text-[var(--red)]"
            >
              Add from your Licence Centre
              <span className="ml-[5px] font-normal text-[var(--text-tertiary)]">
                {slot.inCentre}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onScan}
            className="min-h-[38px] rounded-[var(--r-sm)] border border-[var(--border-hover)] px-[12px] text-[13px] font-medium text-[var(--text-primary)]"
          >
            Scan it
          </button>
          {/*
            A label, not a button: the file input is the control and a button
            wrapping it would need a click forwarded by hand. Same shape the
            shelf's Upload tile uses.
          */}
          <label
            htmlFor={id}
            className="inline-flex min-h-[38px] cursor-pointer items-center rounded-[var(--r-sm)] border border-[var(--border-hover)] px-[12px] text-[13px] font-medium text-[var(--text-primary)]"
          >
            Upload a file
          </label>
          <input
            id={id}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="sr-only"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) onUpload(files);
            }}
          />
        </div>
      )}

      {picker && picker.kind === slot.kind ? (
        <div className="mt-[8px]">{picker.node}</div>
      ) : null}
    </div>
  );
}

export default function CredentialPair({
  credentials,
  onScan,
  onUpload,
  onAddFromCentre,
  picker,
}: CredentialPairProps) {
  const { competency, proficiency, neededLabel, pairNote, knowledge } =
    credentials;

  return (
    <div className="mt-4 rounded-[var(--r-md)] border border-[var(--border)] px-[14px] py-[4px]">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border-divider)] py-[10px]">
        <h3 className="m-0 font-[family-name:var(--font-head)] text-[13.5px] font-medium text-[var(--text-primary)]">
          The two documents behind it
        </h3>
        {/*
          ⚠️ THE CLASS, WHERE WE CAN NAME ONE. "Handgun" is the difference
          between a member fetching the right certificate and fetching the one
          nearest the front of the file — and H10 is what happens when nobody
          says it: a handgun competency attached, unasked, to a rifle
          application.
        */}
        {neededLabel ? (
          <span className="flex-shrink-0 rounded-full border border-[var(--border)] px-[8px] py-[2px] text-[11.5px] text-[var(--text-secondary)]">
            {neededLabel}
          </span>
        ) : null}
      </div>

      <Slot
        slot={competency}
        onScan={onScan}
        onUpload={onUpload}
        onAddFromCentre={onAddFromCentre}
        picker={picker}
      />
      <Slot
        slot={proficiency}
        onScan={onScan}
        onUpload={onUpload}
        onAddFromCentre={onAddFromCentre}
        picker={picker}
      />

      {pairNote ? (
        <p className="m-0 border-t border-[var(--border-divider)] py-[10px] text-[12.5px] leading-[1.45] text-[var(--gold-strong)]">
          {pairNote}
        </p>
      ) : null}

      {/*
        ⚠️ 'UNREAD' IS NOT 'MISSING', AND ONLY ONE OF THEM IS AN ACCUSATION.
        sa-proficiency-cover keeps the two apart because a photograph taken at
        an angle and a course somebody never did look identical to a
        per-document check. Sending a member back to a training provider for a
        reprint of a course they passed is the failure this guards.
      */}
      {knowledge.state !== 'CONFIRMED' && knowledge.alert ? (
        <p
          className={`m-0 border-t border-[var(--border-divider)] py-[10px] text-[12.5px] leading-[1.45] ${
            knowledge.state === 'MISSING'
              ? 'text-[var(--gold-strong)]'
              : 'text-[var(--text-tertiary)]'
          }`}
        >
          {knowledge.alert}
        </p>
      ) : null}
    </div>
  );
}
