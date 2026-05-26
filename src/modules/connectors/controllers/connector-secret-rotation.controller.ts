import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ConnectorSecretRotationService } from '../services/connector-secret-rotation.service';

/**
 * Admin endpoints for connector secret hygiene.
 *
 *   POST /admin/connectors/secret-rotation/backfill
 *     Re-encrypt plaintext connector secret fields under the current key.
 *
 *   POST /admin/connectors/secret-rotation/rotate
 *     Migrate secret envelopes from a previous key (SECRET_ENCRYPTION_KEY_OLD)
 *     onto the current key. Accepts {oldKeyEnv?: string} to override.
 */
@ApiTags('admin connectors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/connectors/secret-rotation')
export class ConnectorSecretRotationController {
  constructor(
    private readonly rotation: ConnectorSecretRotationService,
  ) {}

  @Post('backfill')
  @ApiOperation({
    summary:
      'Re-encrypt plaintext connector secret fields under the current key. Idempotent.',
  })
  async backfill() {
    return this.rotation.backfill();
  }

  @Post('rotate')
  @ApiOperation({
    summary:
      'Rotate connector secrets from a previous key onto the current key.',
  })
  async rotate(@Body() body?: { oldKeyEnv?: string }) {
    return this.rotation.rotate(body?.oldKeyEnv);
  }
}
