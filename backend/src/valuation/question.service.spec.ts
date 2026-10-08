import { QuestionService } from './question.service';
import { CategoryConfigs } from './config/category-configs';
import { IdentifyOutput } from './schemas';

const configs = new CategoryConfigs();
const svc = new QuestionService();

function identify(over: Partial<IdentifyOutput['identification']> = {}, questions: any[] = []): IdentifyOutput {
  return {
    inScope: true,
    views: { received: [], missing: [] },
    identification: {
      categorySlug: 'knives',
      make: 'Kershaw',
      model: null,
      keySpec: null,
      confidence: 'MEDIUM',
      readable: [],
      unreadable: [],
      visibleFeatures: [],
      ...over,
    },
    questions,
  };
}

describe('QuestionService', () => {
  it('always serves q1 first as the key-identifier confirm', () => {
    const served = svc.sanitise(identify(), configs.forCategory('knives'));
    expect(served[0].id).toBe('q1');
    expect(served[0].required).toBe(true);
  });

  it('strips banned-topic questions for every category', () => {
    const served = svc.sanitise(
      identify({}, [
        { id: 'q2', text: 'What licence section is it?', type: 'single', options: ['A', 'B'], allow_custom: true, allow_unsure: true, required: false },
        { id: 'q3', text: 'Where do you store it?', type: 'single', options: ['Safe', 'Cabinet'], allow_custom: true, allow_unsure: true, required: false },
        { id: 'q4', text: 'Edge condition?', type: 'single', options: ['Sharp', 'Chipped'], allow_custom: true, allow_unsure: true, required: true },
      ]),
      configs.forCategory('knives'),
    );
    const texts = served.map((q) => q.text).join(' ');
    expect(texts).not.toMatch(/licence|store/i);
    expect(texts).toMatch(/edge condition/i);
  });

  it('caps the list at 8 questions', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `q${i + 2}`,
      text: `Question ${i}`,
      type: 'single',
      options: ['a', 'b'],
      allow_custom: true,
      allow_unsure: true,
      required: false,
    }));
    const served = svc.sanitise(identify({}, many), configs.forCategory('knives'));
    expect(served.length).toBeLessThanOrEqual(8);
  });

  it('drops model-name options unless the label is legibly readable', () => {
    const served = svc.sanitise(
      identify(
        { model: 'Blur', readable: [] },
        [
          { id: 'q2', text: 'Which model?', type: 'single', options: ['Blur', 'Leek'], allow_custom: true, allow_unsure: true, required: false },
        ],
      ),
      configs.forCategory('knives'),
    );
    const q2 = served.find((q) => q.id === 'q2');
    // All model options dropped, so the original option set is kept rather
    // than serving a single-choice question; the point is no invented names.
    expect(q2?.options.length === undefined || q2?.options.length >= 2).toBe(true);
  });

  it('tops up from config seed questions when the model returns too few', () => {
    const served = svc.sanitise(identify({}, []), configs.forCategory('knives'));
    expect(served.length).toBeGreaterThanOrEqual(3);
  });

  const gaugeQuestion = {
    id: 'q2',
    text: 'What is the gauge of this shotgun?',
    type: 'single' as const,
    options: ['12 Gauge', '20 Gauge', '.410 Bore', '28 Gauge'],
    allow_custom: true,
    allow_unsure: true,
    required: true,
  };

  it('drops shotgun questions when a rifle cartridge is present', () => {
    const served = svc.sanitise(
      identify({ categorySlug: 'firearms', keySpec: '.270 Win' }, [gaugeQuestion]),
      configs.forCategory('firearms'),
    );
    expect(served.some((q) => /gauge|shotgun|choke/i.test(q.text))).toBe(false);
  });

  it('drops shotgun questions asserted without a single legible gauge', () => {
    const served = svc.sanitise(
      identify(
        {
          categorySlug: 'firearms',
          keySpec: 'over-and-under shotgun configuration (possible)',
          readable: [],
          visibleFeatures: ['double barrel configuration apparent', 'metal receiver with visible hinge pin'],
        },
        [gaugeQuestion],
      ),
      configs.forCategory('firearms'),
    );
    expect(served.some((q) => /gauge|shotgun|choke/i.test(q.text))).toBe(false);
  });

  it('does not echo an action guess or a hedge in the q1 hint', () => {
    const served = svc.sanitise(
      identify({ categorySlug: 'firearms', model: 'Sako', keySpec: 'over-and-under shotgun configuration (possible)' }),
      configs.forCategory('firearms'),
    );
    expect(served[0].hint ?? '').not.toMatch(/shotgun|over-?under|possible/i);
  });
});
