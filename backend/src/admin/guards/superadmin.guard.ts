import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const admin = request['adminUser'] as { role?: string } | undefined;
    if (admin?.role !== 'SUPERADMIN') throw new ForbiddenException('Superadmin only');
    return true;
  }
}
