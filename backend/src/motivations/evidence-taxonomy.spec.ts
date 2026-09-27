import {
  CONTAINER_VERSION,
  EVIDENCE_ANNEXURE_MAX,
  EVIDENCE_BODY_MAX,
  EVIDENCE_CONTAINER_LIST,
  EVIDENCE_CONTAINERS,
  EVIDENCE_VAULT_MAX,
  annexureContainers,
  bodyContainers,
  containerById,
  isAnnexureEvidence,
  isContainerId,
  pickableContainers,
} from './evidence-taxonomy';
import { RETIRED } from './motivation-documents';
import { CredentialKind, MotivationUploadKind } from '@prisma/client';

// The registry is data the classifier is asked to answer in, so every
// invariant here is one a bad answer or a careless edit would violate
// silently. These are cheap tests with expensive failures.

const KIND_VALUES: string[] = Object.values(MotivationUploadKind);
// ⚠️ BOTH ENUMS. CredentialKind only partly overlaps MotivationUploadKind —
// seven of its values are its alone — so a spec that checks one enum leaves
// those seven unchecked.
const CREDENTIAL_KIND_VALUES: string[] = Object.values(CredentialKind);

describe('EVIDENCE_CONTAINERS', () => {
  it('ids are unique', () => {
    const ids = EVIDENCE_CONTAINERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no id collides with EITHER document-kind enum', () => {
    // The union of the namespaces is the classifier's answer space, and
    // annexureByKind keys its map by both. A collision titles a page wrongly.
    for (const c of EVIDENCE_CONTAINERS) {
      expect(KIND_VALUES).not.toContain(c.id);
      expect(CREDENTIAL_KIND_VALUES).not.toContain(c.id);
    }
  });

  it('the two enums genuinely differ, so checking one would miss values', () => {
    // Guards the spec itself: if CredentialKind ever became a subset of
    // MotivationUploadKind, the second assertion above would be redundant —
    // it is not, and this pins why.
    const onlyInCredential = CREDENTIAL_KIND_VALUES.filter(
      (v) => !KIND_VALUES.includes(v),
    );
    expect(onlyInCredential.length).toBeGreaterThan(0);
  });

  it('no id collides with a MotivationUploadKind value', () => {
    for (const c of EVIDENCE_CONTAINERS) {
      expect(KIND_VALUES).not.toContain(c.id);
    }
  });

  it('ids are stable SCREAMING_SNAKE and never renamed casually', () => {
    for (const c of EVIDENCE_CONTAINERS) {
      expect(c.id).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('every container has a label, a hint and a placement', () => {
    for (const c of EVIDENCE_CONTAINERS) {
      expect(c.label.trim().length).toBeGreaterThan(0);
      expect(c.hint.trim().length).toBeGreaterThan(0);
      expect(['annexure', 'body']).toContain(c.placement);
    }
  });

  it('every satisfies is a current, non-retired kind', () => {
    // A ticked row is a claim; a retired or misspelled kind would tick nothing
    // and be read as a stale reference forever.
    for (const c of EVIDENCE_CONTAINERS) {
      if (!c.satisfies) continue;
      expect(KIND_VALUES).toContain(c.satisfies);
      expect(RETIRED).not.toContain(c.satisfies);
    }
  });

  it('has both placements represented', () => {
    // The whole design splits on this. Losing one side would silently route
    // either every document or every photograph into the wrong page.
    expect(annexureContainers().length).toBeGreaterThan(0);
    expect(bodyContainers().length).toBeGreaterThan(0);
  });

  it('annexure + body partition the registry', () => {
    expect(annexureContainers().length + bodyContainers().length).toBe(
      EVIDENCE_CONTAINERS.length,
    );
  });

  it('captures the operator\u2019s original examples', () => {
    const ids = EVIDENCE_CONTAINERS.map((c) => c.id);
    // Hunting photographs, reloading bench, shooting at the range, cleaning
    // firearms, shooting results, and a farmer's permission letter.
    expect(ids).toContain('HUNTING_PHOTO');
    expect(ids).toContain('RELOADING_BENCH_PHOTO');
    expect(ids).toContain('RANGE_PHOTO');
    expect(ids).toContain('CLEANING_SESSION_PHOTO');
    expect(ids).toContain('SCORE_SHEET');
    expect(ids).toContain('FARM_PERMISSION_LETTER');
    expect(containerById('FARM_PERMISSION_LETTER')?.placement).toBe('annexure');
  });
});

describe('the rendered container list', () => {
  it('names every id exactly once, as a prompt-drift guard', () => {
    // The system prompt is built from this string. If an id is missing the
    // model can never return it; if it appears twice the prompt has drifted
    // from the registry.
    for (const c of EVIDENCE_CONTAINERS) {
      const occurrences = EVIDENCE_CONTAINER_LIST.split(c.id).length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it('carries the placement of each container for the model to read', () => {
    for (const c of EVIDENCE_CONTAINERS) {
      expect(EVIDENCE_CONTAINER_LIST).toContain(`- ${c.id} [${c.placement}]`);
    }
  });

  it('is byte-stable: one line per container, derived from the registry alone', () => {
    // ⚠️ BYTE-STABILITY IS WHAT LETS THE PROMPT CACHE HIT. `expect(X).toBe(X)`
    // on a module constant asserts nothing — any rendered string satisfies it.
    // What must hold is that the block is EXACTLY the registry, with nothing
    // volatile interpolated per call, so assert observable properties.
    const lines = EVIDENCE_CONTAINER_LIST.split('\n');
    expect(lines).toHaveLength(EVIDENCE_CONTAINERS.length);
    expect(new Set(lines).size).toBe(lines.length);
    // The version is cache-key material, never prompt material — a bump must
    // invalidate the cache without editing the cached block.
    expect(EVIDENCE_CONTAINER_LIST).not.toContain(CONTAINER_VERSION);
    expect(CONTAINER_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('lookups', () => {
  it('containerById returns null for an unknown id rather than throwing', () => {
    expect(containerById('NOT_A_CONTAINER')).toBeNull();
    expect(containerById(null)).toBeNull();
    expect(containerById(undefined)).toBeNull();
    expect(containerById('')).toBeNull();
  });

  it('isContainerId validates', () => {
    expect(isContainerId('HUNTING_PHOTO')).toBe(true);
    expect(isContainerId('HUNTING_PHOTOGRAPHS')).toBe(false);
  });

  it('an unknown id is not an annexure', () => {
    // Free-text column: a row written against a deleted container must read as
    // generic evidence, never claim a letter that cannot be titled.
    expect(isAnnexureEvidence('HUNTING_PHOTO')).toBe(false);
    expect(isAnnexureEvidence('SCORE_SHEET')).toBe(true);
    expect(isAnnexureEvidence('DELETED_CONTAINER')).toBe(false);
    expect(isAnnexureEvidence(null)).toBe(false);
  });

  it('pickableContainers narrows to a group', () => {
    const hunting = pickableContainers('hunting');
    expect(hunting.length).toBeGreaterThan(0);
    for (const c of hunting) expect(c.group).toBe('hunting');
    expect(pickableContainers().length).toBe(EVIDENCE_CONTAINERS.length);
  });
});

describe('caps', () => {
  it('are the numbers the operator asked for', () => {
    expect(EVIDENCE_VAULT_MAX).toBe(30);
    expect(EVIDENCE_BODY_MAX).toBe(4);
    expect(EVIDENCE_ANNEXURE_MAX).toBe(2);
  });
});
