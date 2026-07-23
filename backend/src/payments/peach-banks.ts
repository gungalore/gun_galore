// ─── Peach Payouts bank vocabulary + BANV evaluation (pure) ───────────
//
// Peach's create-payout `bankName` is a strict ENUM (verbatim from their
// OpenAPI schema, 2026-07-23). Our User.bankName is operator-entered text,
// so payouts map through normaliseBankName(); the frontend bank picker
// (frontend/lib/sa-banks.ts) mirrors this list — keep the two in sync.

export const PEACH_BANKS = [
  'STANDARD BANK',
  'NEDBANK',
  'FNB',
  'OLD MUTUAL BANK',
  'ACCESS BANK',
  'AFRICAN BANK',
  'UBANK LTD',
  'BIDVEST BANK',
  'BIDVEST BANK ALLIANCES',
  'CAPITEC BANK',
  'ABSA',
  'HBZ BANK LIMITED',
  'FINBOND MUTUAL BANK',
  'INVESTEC BANK LIMITED',
  'FINBOND EPE',
  'DISCOVERY BANK',
  'TYMEBANK',
  'SASFIN BANK',
  'STANDARD CHARTERED BANK SA',
  'ALBARAKA BANK',
  'CAPITEC BUSINESS',
  'AFRICAN BANK BUSINESS',
  'BANK ZERO MUTUAL BANK',
  'YWBN MUTUAL BANK',
] as const;
export type PeachBank = (typeof PEACH_BANKS)[number];

// Common local spellings → Peach enum. Keys are compared lowercased with
// non-letters stripped.
const ALIASES: Record<string, PeachBank> = {
  fnb: 'FNB',
  firstnationalbank: 'FNB',
  absa: 'ABSA',
  absabank: 'ABSA',
  nedbank: 'NEDBANK',
  standardbank: 'STANDARD BANK',
  standard: 'STANDARD BANK',
  capitec: 'CAPITEC BANK',
  capitecbank: 'CAPITEC BANK',
  capitecbusiness: 'CAPITEC BUSINESS',
  tyme: 'TYMEBANK',
  tymebank: 'TYMEBANK',
  discovery: 'DISCOVERY BANK',
  discoverybank: 'DISCOVERY BANK',
  investec: 'INVESTEC BANK LIMITED',
  africanbank: 'AFRICAN BANK',
  bidvest: 'BIDVEST BANK',
  bidvestbank: 'BIDVEST BANK',
  bankzero: 'BANK ZERO MUTUAL BANK',
  sasfin: 'SASFIN BANK',
  oldmutual: 'OLD MUTUAL BANK',
  oldmutualbank: 'OLD MUTUAL BANK',
  albaraka: 'ALBARAKA BANK',
  hbz: 'HBZ BANK LIMITED',
  hbzbank: 'HBZ BANK LIMITED',
  sasfinbank: 'SASFIN BANK',
  ubank: 'UBANK LTD',
  accessbank: 'ACCESS BANK',
  standardchartered: 'STANDARD CHARTERED BANK SA',
  finbond: 'FINBOND MUTUAL BANK',
};

/** Map free-text bank name to the Peach enum, or null when unmappable
 *  (the payout run skips the row with a clear reason rather than guessing). */
export function normaliseBankName(raw: string | null | undefined): PeachBank | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if ((PEACH_BANKS as readonly string[]).includes(upper)) return upper as PeachBank;
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  return ALIASES[key] ?? null;
}

// Our stored account types → Peach BANV accountType enum.
export const BANV_ACCOUNT_TYPE: Record<string, string> = {
  cheque: 'current_cheque_account',
  savings: 'savings_account',
  transmission: 'transmission_account',
};

export type BanvFlag = 'positive' | 'negative' | 'unverified';

export interface BanvMatches {
  accountNumber?: BanvFlag;
  idNumber?: BanvFlag;
  initials?: BanvFlag;
  lastName?: BanvFlag;
  accountOpen?: BanvFlag;
  accountAcceptsCredits?: BanvFlag;
}

/**
 * PASS rule for paying a seller:
 *  - the account exists (accountNumber positive) and is open,
 *  - the SA ID matches the account holder (the ownership check), and
 *  - the account doesn't refuse credits.
 * Name/initials are ADVISORY only (banks report them inconsistently for
 * initialised or business accounts) — a negative there never blocks alone.
 */
export function evaluateBanvMatches(m: BanvMatches): 'passed' | 'mismatch' {
  const ok =
    m.accountNumber === 'positive' &&
    m.accountOpen === 'positive' &&
    m.idNumber === 'positive' &&
    m.accountAcceptsCredits !== 'negative';
  return ok ? 'passed' : 'mismatch';
}

/** Compact audit string of the flags, e.g. "acct+ id+ open+ cred? name-". */
export function banvFlagsSummary(m: BanvMatches): string {
  const sym = (f?: BanvFlag) =>
    f === 'positive' ? '+' : f === 'negative' ? '-' : '?';
  return `acct${sym(m.accountNumber)} id${sym(m.idNumber)} open${sym(m.accountOpen)} cred${sym(m.accountAcceptsCredits)} name${sym(m.lastName)}`;
}
