// ─── Ozow Payouts bank vocabulary (pure) ───────────────────────────────
//
// Ozow's payout request needs TWO identifiers for the destination bank:
//   - `bankGroupId`      — Ozow's UUID for the bank group (from
//                          GET /getavailablebanks, which we cache).
//   - `branchCode`       — the universal branch code (branchCode).
//
// We store sellers' bank names as operator-entered text (User.bankName), so
// payouts resolve the universal branch code here, then map branch code →
// bankGroupId from Ozow's live bank list (see ozow.service.ts). The frontend
// bank picker (frontend/lib/sa-banks.ts) mirrors this list — keep the two in
// sync: a name the mapper can't resolve means the payout is skipped with a
// "re-pick your bank" reason, never guessed.

export interface OzowBank {
  /** Ozow's own bank-group display name (matched case-insensitively). */
  groupName: string;
  /** Universal branch code the seller's `branchCode` is normalised against. */
  universalBranchCode: string;
}

export const OZOW_BANKS: OzowBank[] = [
  { groupName: 'ABSA', universalBranchCode: '632005' },
  { groupName: 'Capitec Bank', universalBranchCode: '470010' },
  { groupName: 'FNB', universalBranchCode: '250655' },
  { groupName: 'Nedbank', universalBranchCode: '198765' },
  { groupName: 'Standard Bank', universalBranchCode: '051001' },
  { groupName: 'TymeBank', universalBranchCode: '678910' },
  { groupName: 'African Bank', universalBranchCode: '430000' },
  { groupName: 'Bank Zero', universalBranchCode: '888000' },
  { groupName: 'Bidvest Bank', universalBranchCode: '462005' },
  { groupName: 'Discovery Bank', universalBranchCode: '679000' },
  { groupName: 'Investec Bank', universalBranchCode: '580105' },
  { groupName: 'Sasfin Bank', universalBranchCode: '683000' },
];

// Common local spellings → Ozow group name. Compared lowercased with
// non-letters stripped.
const ALIASES: Record<string, string> = {
  fnb: 'FNB',
  firstnationalbank: 'FNB',
  absa: 'ABSA',
  absabank: 'ABSA',
  nedbank: 'Nedbank',
  standardbank: 'Standard Bank',
  standard: 'Standard Bank',
  capitec: 'Capitec Bank',
  capitecbank: 'Capitec Bank',
  capitecbusiness: 'Capitec Bank',
  tyme: 'TymeBank',
  tymebank: 'TymeBank',
  discovery: 'Discovery Bank',
  discoverybank: 'Discovery Bank',
  investec: 'Investec Bank',
  investecbank: 'Investec Bank',
  africanbank: 'African Bank',
  bidvest: 'Bidvest Bank',
  bidvestbank: 'Bidvest Bank',
  bankzero: 'Bank Zero',
  sasfin: 'Sasfin Bank',
  sasfinbank: 'Sasfin Bank',
};

/** Map free-text bank name to an Ozow bank, or null when unmappable (the
 *  payout run skips the row with a clear reason rather than guessing). */
export function normaliseOzowBank(
  raw: string | null | undefined,
): OzowBank | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  const groupName = ALIASES[key];
  if (groupName) {
    return OZOW_BANKS.find((b) => b.groupName === groupName) ?? null;
  }
  return (
    OZOW_BANKS.find(
      (b) => b.groupName.toLowerCase().replace(/[^a-z]/g, '') === key,
    ) ?? null
  );
}

/** Resolve a branch code (typed or universal) to the Ozow bank carrying that
 *  universal code, or null. */
export function bankByBranchCode(branchCode: string | null | undefined): OzowBank | null {
  if (!branchCode) return null;
  const code = branchCode.trim();
  return (
    OZOW_BANKS.find((b) => b.universalBranchCode === code) ??
    normaliseOzowBank(branchCode)
  );
}
