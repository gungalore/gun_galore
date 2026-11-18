import { topicForField } from './intake-topics';

describe('the intake topics', () => {
  it('puts the game species with the hunting, not the association', () => {
    // MO000129: "What game species do you intend to hunt?" appeared under
    // "Association and dedicated status" on an occasional Section 15.
    expect(topicForField('intended_quarry')).toBe('activities');
  });

  it('keeps the membership and dedicated facts together', () => {
    expect(topicForField('association_name')).toBe('association');
    expect(topicForField('dedicated_since')).toBe('association');
  });

  it('puts the ownership gate with the owned-firearms table', () => {
    expect(topicForField('has_existing_firearms')).toBe('existing');
    expect(topicForField('existing_firearm_count')).toBe('existing');
    expect(topicForField('existing_firearm_1_make')).toBe('existing');
  });
});
