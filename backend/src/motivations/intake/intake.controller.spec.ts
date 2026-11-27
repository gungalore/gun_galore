import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { MotivationsIntakeController } from './intake.controller';
import { MotivationsController } from '../motivations.controller';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE NEW WRITER-MODE ROUTES.
 *
 * The path is a string in a decorator and a template in the client, so nothing
 * in the compiler connects them (api-route-contract.spec.ts holds that line).
 * What this pins is the CONTRACT around each handler: the route exists, the
 * model-spending one is throttled like POST :id/reason, and each delegates to
 * the service with the arguments the client sends.
 * ────────────────────────────────────────────────────────────────────────────
 */

const LIMIT = 'THROTTLER:LIMITdefault';
const TTL = 'THROTTLER:TTLdefault';
const MINUTE = 60_000;

const routeOf = (fn: unknown) => ({
  path: Reflect.getMetadata('path', fn as object),
  method: Reflect.getMetadata('method', fn as object),
});

const throttleOf = (fn: unknown) => ({
  limit: Reflect.getMetadata(LIMIT, fn as object),
  ttl: Reflect.getMetadata(TTL, fn as object),
});

function intakeWithStubs(
  overrides: Partial<Record<string, (...args: never[]) => unknown>> = {},
) {
  const calls: { method: string; args: unknown[] }[] = [];
  const stub = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return overrides[method]
      ? (overrides[method] as (...a: unknown[]) => unknown)(...(args as never[]))
      : Promise.resolve(undefined);
  };
  const controller = Object.create(
    MotivationsIntakeController.prototype,
  ) as MotivationsIntakeController;
  Object.assign(controller as unknown as Record<string, unknown>, {
    intake: {
      state: stub('state'),
      cardForTopic: stub('cardForTopic'),
      patchAnswers: stub('patchAnswers'),
      draftNarrative: stub('draftNarrative'),
    },
  });
  return { controller, calls };
}

describe('the intake controller routes', () => {
  const proto = MotivationsIntakeController.prototype;

  it('serves GET :id/intake/card with the topic query', async () => {
    expect(routeOf(proto.card).path).toBe(':id/intake/card');
    const { controller, calls } = intakeWithStubs({
      cardForTopic: () => Promise.resolve({ group: null, navigation: { back: null } }),
    });
    const result = await controller.card('user-1', 'mo-1', 'identity');
    expect(calls[0]).toEqual({
      method: 'cardForTopic',
      args: ['user-1', 'mo-1', 'identity'],
    });
    expect(result).toMatchObject({ navigation: { back: null } });
  });

  it('saves an edited card through PATCH :id/intake/answers', async () => {
    expect(routeOf(proto.patchAnswers).path).toBe(':id/intake/answers');
    const { controller, calls } = intakeWithStubs();
    await controller.patchAnswers('user-1', 'mo-1', {
      answers: { full_name: 'A B' },
    });
    expect(calls[0]).toEqual({
      method: 'patchAnswers',
      args: ['user-1', 'mo-1', { full_name: 'A B' }],
    });
  });

  it('coerces a missing or malformed answers body rather than trusting it', async () => {
    const { controller, calls } = intakeWithStubs();
    await controller.patchAnswers('user-1', 'mo-1', undefined as never);
    expect(calls[0].args[2]).toEqual({});
  });

  it('is throttled to 6/min, like the reason generator it mirrors', () => {
    // ⚠️ IT IS A MODEL CALL and the screen polls while drafting; without the
    // limit a stuck page would be a bill with no ceiling.
    expect(routeOf(proto.draft).path).toBe(':id/intake/draft');
    expect(throttleOf(proto.draft)).toEqual({ limit: 6, ttl: MINUTE });
  });

  it('returns the rebuilt state together with the draft counts', async () => {
    const { controller } = intakeWithStubs({
      draftNarrative: () =>
        Promise.resolve({
          state: { motivationId: 'mo-1' },
          drafted: 3,
          failed: 1,
        }),
    });
    // The handler wraps the service result: the wire shape is
    // { state, drafted, failed }.
    const wrapped = await controller.draft('user-1', 'mo-1');
    expect(wrapped).toEqual({
      state: { motivationId: 'mo-1' },
      drafted: 3,
      failed: 1,
    });
  });
});

describe('the confirm-answer route', () => {
  it('declares POST :id/answers/confirm next to the answers save', () => {
    expect(routeOf(MotivationsController.prototype.confirmAnswer).path).toBe(
      ':id/answers/confirm',
    );
  });

  it('confirms one key through the facade and answers { ok: true }', async () => {
    const confirmed: string[] = [];
    const controller = Object.create(
      MotivationsController.prototype,
    ) as MotivationsController;
    Object.assign(controller as unknown as Record<string, unknown>, {
      motivations: {
        confirmAnswer: async (_u: string, _i: string, key: string) => {
          confirmed.push(key);
        },
      },
    });
    await expect(
      controller.confirmAnswer('user-1', 'mo-1', { key: 'shooting_history' }),
    ).resolves.toEqual({ ok: true });
    expect(confirmed).toEqual(['shooting_history']);
  });

  it('refuses an empty key at the door', async () => {
    const controller = Object.create(
      MotivationsController.prototype,
    ) as MotivationsController;
    Object.assign(controller as unknown as Record<string, unknown>, {
      motivations: { confirmAnswer: async () => undefined },
    });
    await expect(
      controller.confirmAnswer('user-1', 'mo-1', { key: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
