/**
 * PIN THE MEMBER-FACING COMPLAINT LABELS.
 *
 * The page that renders these lives under app/, which vitest does not collect.
 * The failure this suite prevents is small and embarrassing rather than severe:
 * a status added upstream rendering as a blank pill, or `UNDER_REVIEW` being
 * shown raw to the member whose case it is.
 */
import { describe, expect, it } from 'vitest';
import {
  complaintCategoryLabel,
  complaintHistoryLine,
  complaintStatusTone,
} from './complaint-status';

const formatDate = (value: string) => `D(${value})`;

describe('complaint status tone', () => {
  it('names every status the backend can store', () => {
    expect(complaintStatusTone('OPEN')).toMatchObject({
      label: 'Open',
      color: 'var(--warning)',
    });
    expect(complaintStatusTone('UNDER_REVIEW').label).toBe('Under review');
    expect(complaintStatusTone('AWAITING_USER').label).toBe('Waiting on you');
    expect(complaintStatusTone('RESOLVED')).toMatchObject({
      label: 'Resolved',
      color: 'var(--success)',
    });
    expect(complaintStatusTone('CLOSED').label).toBe('Closed');
  });

  it('accepts lowercase/whitespace from a hand-edited row', () => {
    expect(complaintStatusTone(' resolved ').label).toBe('Resolved');
  });

  it('never prints a raw enum or a blank pill for an unknown status', () => {
    expect(complaintStatusTone('ESCALATED_TO_OMBUD').label).toBe(
      'escalated to ombud',
    );
    expect(complaintStatusTone('').label).toBe('Unknown');
    expect(complaintStatusTone('   ').label).toBe('Unknown');
  });
});

describe('complaint category label', () => {
  it('names the intake categories in member language', () => {
    expect(complaintCategoryLabel('NOT_ARRIVED')).toBe('Item never arrived');
    expect(complaintCategoryLabel('ITEM_NOT_AS_DESCRIBED')).toBe(
      'Item not as described',
    );
    expect(complaintCategoryLabel('LOCATION_OR_ACCESS')).toBe(
      'Could not reach the item',
    );
  });

  it('falls back to a readable form rather than the raw enum', () => {
    expect(complaintCategoryLabel('SOMETHING_NEW')).toBe('something new');
    expect(complaintCategoryLabel('')).toBe('Complaint');
  });
});

describe('complaint history line', () => {
  it('reports the resolution date once there is one', () => {
    expect(
      complaintHistoryLine(
        { createdAt: 'created', resolvedAt: 'resolved' },
        formatDate,
      ),
    ).toBe('Logged D(created) · Resolved D(resolved)');
  });

  it('reports only the log date while the case is open', () => {
    expect(
      complaintHistoryLine(
        { createdAt: 'created', resolvedAt: null },
        formatDate,
      ),
    ).toBe('Logged D(created)');
  });
});
