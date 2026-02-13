import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to require a specific feature entitlement
 * Use with EntitlementGuard
 *
 * @example
 * ```typescript
 * @Post()
 * @UseGuards(JwtAuthGuard, EntitlementGuard)
 * @RequireFeature('classifications.bulkUpload')
 * async bulkClassify() {
 *   // This will only execute if the user's plan includes bulk upload
 * }
 * ```
 */
export const RequireFeature = (feature: string) => SetMetadata('requiredFeature', feature);
