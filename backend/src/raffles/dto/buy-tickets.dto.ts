import { IsIn, IsInt, Min, Max } from 'class-validator';

// Per-spec: no per-person ticket limit, so we just cap at a sane
// per-transaction maximum (100). Buyer must answer the multiple-choice
// question; backend rejects anything other than 'C'.
export class BuyTicketsDto {
  @IsInt()
  @Min(1)
  @Max(100)
  quantity: number;

  // One of 'A' | 'B' | 'C' | 'D' — uppercased on the frontend.
  @IsIn(['A', 'B', 'C', 'D'])
  answer: 'A' | 'B' | 'C' | 'D';
}
