import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import { LocalDiskStorageAdapter } from '../adapters/local-disk-storage.adapter';
import { DocumentStorageService } from '../document-storage.service';

/**
 * Documents controller — two responsibilities:
 *  1) Authenticated tenant-scoped sign endpoint that issues a short-lived
 *     read URL for any storage key whose tenant prefix matches the caller.
 *  2) Public signed-URL resolver used by the local-disk dev adapter. The
 *     S3 adapter issues real presigned URLs and never hits this route.
 */
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly storage: DocumentStorageService,
    private readonly localAdapter: LocalDiskStorageAdapter,
  ) {}

  @Get('sign')
  async sign(
    @Req() req: Request,
    @Query('storageKey') storageKey?: string,
    @Query('fileName') fileName?: string,
    @Query('expiresInSeconds') expiresInSeconds?: string,
  ) {
    if (!storageKey) {
      throw new BadRequestException('storageKey is required');
    }
    const ctx = resolveRequestContext(req);
    const url = await this.storage.createReadUrl(storageKey, {
      organizationId: ctx.organizationId,
      fileName,
      expiresInSeconds: expiresInSeconds
        ? Number(expiresInSeconds)
        : undefined,
    });
    return {
      success: true,
      data: { url, provider: this.storage.providerKey },
    };
  }

  /**
   * Local-disk adapter serves signed URLs through this route. The signature
   * itself encodes tenant + expiry, so the route is intentionally public —
   * possession of the signed URL is the auth proof, matching how S3
   * presigned URLs work.
   */
  @Public()
  @Get('local/:storageKey')
  async serveLocal(
    @Param('storageKey') storageKey: string,
    @Query('org') organizationId: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const expiresAt = Number(exp);
    const { content } = await this.localAdapter.readForSignedUrl(
      decodeURIComponent(storageKey),
      organizationId,
      expiresAt,
      sig,
    );
    res
      .status(200)
      .setHeader('content-type', 'application/octet-stream')
      .setHeader('cache-control', 'private, no-store')
      .send(content);
  }
}
