import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The caller's `User.id`, stamped on the request by whichever auth guard ran.
 *
 * There is exactly ONE user identifier in this codebase. If this is undefined
 * the route is missing a guard — that is a bug, not an anonymous caller;
 * anonymous callers come through {@link OptionalAuthGuard}, which stamps
 * nothing and whose handlers check for undefined deliberately.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.userId as string;
  },
);
