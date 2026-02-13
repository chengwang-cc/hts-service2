import { SetMetadata } from '@nestjs/common';

/**
 * API Permissions Decorator
 * Specify required permissions for an API endpoint
 *
 * @example
 * @ApiPermissions('hts:lookup', 'hts:calculate')
 * async calculate() { ... }
 */
export const ApiPermissions = (...permissions: string[]) =>
  SetMetadata('api-permissions', permissions);
