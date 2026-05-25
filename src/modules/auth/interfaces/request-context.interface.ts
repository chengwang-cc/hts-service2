import type { Request } from 'express';

export interface AuthenticatedRequestUser {
  id: string;
  organizationId: string;
  email?: string;
  roles?: Array<{ permissions?: string[] }>;
}

export interface RequestContext {
  userId: string;
  organizationId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export function resolveRequestContext(request: Request): RequestContext {
  const user = request.user as AuthenticatedRequestUser | undefined;

  return {
    userId: user?.id ?? '',
    organizationId: user?.organizationId ?? '',
    ipAddress:
      (request.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim() ||
      (request.headers['x-real-ip'] as string | undefined) ||
      request.socket.remoteAddress ||
      null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}
