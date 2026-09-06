// The action on a licence card's type row, every way it comes back.
//
// Operator, 2026-09-07, holding the card: "the 223 does list its type as
// self loading" - "Type S/L: RIFLE CAL - RIFLE/CARBINE" - and the vault had
// it as unknown, which let it stand in for a manual-rifle competency.

import { selfLoadingFromText } from '../common/sa-competency';
import { extractDocument, type TextractResponse } from './textract-document-extract';

const MATERIAL = ['licence_number', 'holder_name', 'firearm_type', 'make', 'calibre', 'frame_serial', 'barrel_serial', 'section'];

/** A response of bare lines, and optionally FORMS pairs. */
function res(lines: string[], pairs: [string, string][] = []): TextractResponse {
  const blocks: NonNullable<TextractResponse['Blocks']> = lines.map((t, i) => ({ Id: `L${i}`, BlockType: 'LINE', Text: t, Confidence: 99 }));
  pairs.forEach(([k, v], i) => {
    const kw = k.split(' ').map((w, j) => ({ Id: `KW${i}_${j}`, BlockType: 'WORD', Text: w, Confidence: 99 }));
    const vw = v.split(' ').map((w, j) => ({ Id: `VW${i}_${j}`, BlockType: 'WORD', Text: w, Confidence: 99 }));
    blocks.push(
      { Id: `K${i}`, BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Relationships: [{ Type: 'VALUE', Ids: [`V${i}`] }, { Type: 'CHILD', Ids: kw.map((w) => w.Id as string) }] },
      { Id: `V${i}`, BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Relationships: [{ Type: 'CHILD', Ids: vw.map((w) => w.Id as string) }] },
      ...kw,
      ...vw,
    );
  });
  return { Blocks: blocks };
}
const type = (r: TextractResponse) => extractDocument(r, 'FIREARM_LICENCE', MATERIAL).reading.details.firearm_type;

describe('the action on the type row', () => {
  it('keeps S/L when "Type" shares the line', () => {
    const t = type(res(['Type S/L: RIFLE CAL - RIFLE/CARBINE', 'Make NORDISKE PRECISION']));
    expect(t).toMatch(/^S\/L/);
    expect(selfLoadingFromText(t ?? '')).toBe(true);
  });

  it('keeps it when Type is on its own line', () => {
    const t = type(res(['Type', 'S/L: RIFLE CAL - RIFLE/CARBINE']));
    expect(selfLoadingFromText(t ?? '')).toBe(true);
  });

  it('takes it off a FORMS pair whose key is the abbreviation itself', () => {
    const t = type(res(['Make NORDISKE'], [['S/L:', 'RIFLE CAL - RIFLE/CARBINE']]));
    expect(t).toBe('S/L: RIFLE CAL - RIFLE/CARBINE');
  });

  it('repairs OCR\'s "SIL" back to S/L', () => {
    const t = type(res(['Type', 'SIL: RIFLE CAL - RIFLE/CARBINE']));
    expect(selfLoadingFromText(t ?? '')).toBe(true);
  });

  it('reads a non-self-loading and a manually operated card as manual', () => {
    expect(selfLoadingFromText(type(res(['Type N/S/L: RIFLE CAL - RIFLE/CARBINE'])) ?? '')).toBe(false);
    expect(selfLoadingFromText(type(res(['Type', 'MANUALLY OPERATED RIFLE'])) ?? '')).toBe(false);
  });

  it('leaves a handgun alone', () => {
    expect(type(res(['Type', 'HANDGUN']))).toBe('HANDGUN');
  });
});
