import { DocumentFilingService, type FilingOption } from './document-filing.service';
import type { LlmService } from '../llm/llm.service';
import type { JevAnswer } from '../llm/llm.types';

const KINDS: FilingOption[] = [
  { id: 'FIREARM_LICENCE', label: 'Firearm licence', hint: 'a licence card' },
  { id: 'PROFICIENCY', label: 'Proficiency', hint: 'a results statement' },
  { id: 'OTHER', label: 'Something else', hint: 'anything else' },
];

const CONTAINERS: FilingOption[] = [
  { id: 'HUNTING_PHOTO', label: 'Hunting photo', hint: 'a photo of a hunt' },
  { id: 'OTHER_EVIDENCE', label: 'Other', hint: 'nothing else fits' },
];

function fakeLlm(answers: Record<string, JevAnswer>) {
  return {
    decide: jest.fn(async () => ({
      model: 'jev-1.13.0',
      answers,
      usage: { inputTokens: 1, outputTokens: 0 },
    })),
  } as unknown as LlmService;
}

function svcWith(answers: Record<string, JevAnswer>) {
  return new DocumentFilingService(fakeLlm(answers));
}

const choice = (c: string, confidence = 0.9): JevAnswer => ({
  type: 'choice',
  choice: c,
  probabilities: { [c]: confidence },
  confidence,
});
const noul = (n: number): JevAnswer => ({ type: 'noul', noul: n });

describe('DocumentFilingService', () => {
  const prevKey = process.env.JEV_API_KEY;
  const prevFloor = process.env.JEV_FILING_CONFIDENCE;

  beforeEach(() => {
    process.env.JEV_API_KEY = 'test-key';
    delete process.env.JEV_FILING_CONFIDENCE;
  });
  afterAll(() => {
    if (prevKey === undefined) delete process.env.JEV_API_KEY;
    else process.env.JEV_API_KEY = prevKey;
    if (prevFloor === undefined) delete process.env.JEV_FILING_CONFIDENCE;
    else process.env.JEV_FILING_CONFIDENCE = prevFloor;
  });

  it('is inert without a Jev key', async () => {
    delete process.env.JEV_API_KEY;
    const svc = svcWith({});
    expect(svc.isConfigured()).toBe(false);
    await expect(svc.fileVault({ text: 'x', kindOptions: KINDS })).resolves.toBeNull();
    await expect(svc.fileEvidence({ text: 'x', options: CONTAINERS })).resolves.toBeNull();
  });

  it('files a document by its kind and keeps the also-covers set', async () => {
    const svc = svcWith({
      role: choice('document'),
      kind: choice('PROFICIENCY'),
      cover_FIREARM_LICENCE: noul(0.1),
      cover_PROFICIENCY: noul(0.99),
    });
    const res = await svc.fileVault({
      text: 'STATEMENT OF RESULTS',
      kindOptions: KINDS,
      coverOptions: KINDS,
    });
    expect(res).toMatchObject({
      role: 'document',
      folder: 'PROFICIENCY',
      confident: true,
    });
    // The primary is dropped from also-covers; the low one is not added.
    expect(res!.alsoCovers).toEqual([]);
  });

  it('keeps a genuinely co-occurring role', async () => {
    const svc = svcWith({
      role: choice('document'),
      kind: choice('PROFICIENCY'),
      cover_FIREARM_LICENCE: noul(0.85),
    });
    const res = await svc.fileVault({
      text: 'x',
      kindOptions: KINDS,
      coverOptions: KINDS,
    });
    expect(res!.alsoCovers).toEqual(['FIREARM_LICENCE']);
  });

  it('returns evidence as evidence, with no kind', async () => {
    const svc = svcWith({
      role: choice('evidence'),
      kind: choice('FIREARM_LICENCE'),
    });
    const res = await svc.fileVault({ text: 'a hunt', kindOptions: KINDS });
    expect(res).toMatchObject({ role: 'evidence', confident: true });
    expect(res!.folder).toBe('');
  });

  it('drops an answer naming a folder not in the vocabulary', async () => {
    const svc = svcWith({ role: choice('document'), kind: choice('NOT_A_KIND') });
    await expect(svc.fileVault({ text: 'x', kindOptions: KINDS })).resolves.toBeNull();
  });

  it('marks a low-confidence pick as not confident', async () => {
    const svc = svcWith({ role: choice('document'), kind: choice('OTHER', 0.2) });
    const res = await svc.fileVault({ text: 'x', kindOptions: KINDS });
    expect(res).toMatchObject({ folder: 'OTHER', confident: false });
  });

  it('honours the confidence floor env', async () => {
    process.env.JEV_FILING_CONFIDENCE = '0.9';
    const svc = svcWith({ role: choice('document'), kind: choice('OTHER', 0.7) });
    const res = await svc.fileVault({ text: 'x', kindOptions: KINDS });
    expect(res!.confident).toBe(false);
  });

  it('files an evidence item into a container', async () => {
    const svc = svcWith({ container: choice('HUNTING_PHOTO') });
    const res = await svc.fileEvidence({
      text: 'trophies in the veld',
      description: 'my hunt',
      options: CONTAINERS,
    });
    expect(res).toMatchObject({ folder: 'HUNTING_PHOTO', confident: true });
  });

  it('needs text or a description to file evidence', async () => {
    const svc = svcWith({ container: choice('HUNTING_PHOTO') });
    await expect(
      svc.fileEvidence({ text: '   ', description: null, options: CONTAINERS }),
    ).resolves.toBeNull();
  });

  it('fails soft when Jev throws', async () => {
    const llm = {
      decide: jest.fn(async () => {
        throw new Error('down');
      }),
    } as unknown as LlmService;
    const svc = new DocumentFilingService(llm);
    await expect(svc.fileEvidence({ text: 'x', options: CONTAINERS })).resolves.toBeNull();
    await expect(svc.fileVault({ text: 'x', kindOptions: KINDS })).resolves.toBeNull();
  });

  it('\u26a0\ufe0f TELLS JEV A LICENCE MUST BE A FIREARM LICENCE', async () => {
    // Operator report: a random file came back as a licence. The document
    // vocabulary said only "a licence", so any licence satisfied it.
    const decide = jest.fn((req: { questions: unknown }) => {
      expect(req.questions).toBeDefined();
      return {
        model: 'jev-1.13.0',
        answers: { role: choice('evidence') },
        usage: { inputTokens: 1, outputTokens: 0 },
      };
    });
    const svc = new DocumentFilingService({ decide } as unknown as LlmService);
    await svc.fileVault({
      text: 'SOFTWARE LICENCE AGREEMENT',
      kindOptions: KINDS,
    });
    const questions = decide.mock.calls[0][0].questions as {
      role: { criteria: { document: string; evidence: string } };
      kind: { instructions: string };
    };
    expect(questions.role.criteria.document).toMatch(/FIREARM licence/i);
    expect(questions.role.criteria.evidence).toMatch(/driver/i);
    expect(questions.kind.instructions).toMatch(/names no firearm/i);
  });
});
