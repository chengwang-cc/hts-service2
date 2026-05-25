import { SetMetadata } from '@nestjs/common';

export const ORG_PERMISSIONS_KEY = 'org_permissions';

/**
 * Marks a controller handler as requiring one of the listed permissions on
 * the caller's roles. Enforced by OrgPermissionsGuard. Unlike
 * AdminPermissions, this does not require platform-admin scope — it is the
 * tenant-level RBAC layer used by all broker* controllers.
 */
export const OrgPermissions = (...permissions: string[]) =>
  SetMetadata(ORG_PERMISSIONS_KEY, permissions);
