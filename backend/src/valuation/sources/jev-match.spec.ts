import { JevMatchService } from './jev-match';
import { ItemSpec, ProductHit } from './types';

const ITEM: ItemSpec = { make: 'Redding', model: 'Boss', keySpec: null };

function hit(title: string): ProductHit {
  return { refId: title, title, priceZar: 1000, domain: 'shop.co.za' };
}

function choiceAnswer(choice: string) {
  return { type: 'choice' as const, choice, probabilities: {}, confidence: 0.9 };
}

afterEach(() => {
  delete process.env.VALUATION_JEV_MATCH;
});

describe('JevMatchService', () => {
  it('is inert when the mode is off (default)', async () => {
    const decide = jest.fn();
    const svc = new JevMatchService({ decide } as never);
    const hits = [hit('Redding Boss Press'), hit('Redding Shellholder')];
    await expect(svc.judge(ITEM, hits)).resolves.toEqual(hits);
    expect(decide).not.toHaveBeenCalled();
  });

  it('drops only UNRELATED candidates in live mode', async () => {
    process.env.VALUATION_JEV_MATCH = 'live';
    const decide = jest.fn().mockResolvedValue({
      answers: {
        c0: choiceAnswer('EXACT'),
        c1: choiceAnswer('UNRELATED'),
        c2: choiceAnswer('SIMILAR'),
      },
    });
    const svc = new JevMatchService({ decide } as never);
    const hits = [hit('Redding Boss Press'), hit('Redding Shellholder'), hit('Redding Big Boss')];
    const kept = await svc.judge(ITEM, hits);
    expect(kept.map((h) => h.title)).toEqual(['Redding Boss Press', 'Redding Big Boss']);
  });

  it('keeps every candidate in shadow mode but still calls JEV', async () => {
    process.env.VALUATION_JEV_MATCH = 'shadow';
    const decide = jest.fn().mockResolvedValue({ answers: { c0: choiceAnswer('UNRELATED') } });
    const svc = new JevMatchService({ decide } as never);
    const hits = [hit('Some Die Set')];
    await expect(svc.judge(ITEM, hits)).resolves.toEqual(hits);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('falls back to the regex verdicts when JEV errors', async () => {
    process.env.VALUATION_JEV_MATCH = 'live';
    const decide = jest.fn().mockRejectedValue(new Error('not_configured'));
    const svc = new JevMatchService({ decide } as never);
    const hits = [hit('Redding Boss Press'), hit('Redding Shellholder')];
    await expect(svc.judge(ITEM, hits)).resolves.toEqual(hits);
  });

  it('fails safe on a malformed answer', async () => {
    process.env.VALUATION_JEV_MATCH = 'live';
    const decide = jest.fn().mockResolvedValue({ answers: { c0: { type: 'noul', noul: 0.5 } } });
    const svc = new JevMatchService({ decide } as never);
    const hits = [hit('Redding Boss Press')];
    await expect(svc.judge(ITEM, hits)).resolves.toEqual(hits);
  });

  it('caches a verdict by spec + title, so a repeat does not re-ask', async () => {
    process.env.VALUATION_JEV_MATCH = 'live';
    const decide = jest.fn().mockResolvedValue({ answers: { c0: choiceAnswer('EXACT') } });
    const svc = new JevMatchService({ decide } as never);
    await svc.judge(ITEM, [hit('Redding Boss Press')]);
    await svc.judge(ITEM, [hit('Redding Boss Press')]);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('is inert with no LlmService', async () => {
    process.env.VALUATION_JEV_MATCH = 'live';
    const svc = new JevMatchService();
    const hits = [hit('Redding Boss Press')];
    await expect(svc.judge(ITEM, hits)).resolves.toEqual(hits);
  });
});
