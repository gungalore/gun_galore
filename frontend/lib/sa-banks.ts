// SA banks the payout rail supports. Friendly display names; the backend
// maps them onto the Peach Payouts bankName enum (normaliseBankName in
// backend/src/payments/peach-banks.ts — KEEP THE TWO IN SYNC: a name the
// mapper can't resolve means the seller's payout is skipped with a
// "re-pick your bank" reason). universalCode pre-fills the branch-code
// field on pick (Peach recommends universal branch codes); users can
// still override it. '' = no known universal code, the user types theirs.
export const SA_BANKS: { name: string; universalCode: string }[] = [
  { name: 'ABSA', universalCode: '632005' },
  { name: 'Capitec', universalCode: '470010' },
  { name: 'FNB', universalCode: '250655' },
  { name: 'Nedbank', universalCode: '198765' },
  { name: 'Standard Bank', universalCode: '051001' },
  { name: 'TymeBank', universalCode: '678910' },
  { name: 'African Bank', universalCode: '430000' },
  { name: 'Bank Zero', universalCode: '888000' },
  { name: 'Bidvest Bank', universalCode: '462005' },
  { name: 'Capitec Business', universalCode: '450105' },
  { name: 'Discovery Bank', universalCode: '679000' },
  { name: 'Investec', universalCode: '580105' },
  { name: 'Sasfin Bank', universalCode: '683000' },
  { name: 'Access Bank', universalCode: '' },
  { name: 'Albaraka Bank', universalCode: '' },
  { name: 'Finbond Mutual Bank', universalCode: '' },
  { name: 'HBZ Bank', universalCode: '' },
  { name: 'Old Mutual Bank', universalCode: '' },
  { name: 'Standard Chartered', universalCode: '' },
  { name: 'Ubank', universalCode: '' },
  { name: 'YWBN Mutual Bank', universalCode: '' },
];
