import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  SavedShipmentEntity,
  SavedShipmentLastQuoteSnapshot,
  SavedShipmentStatus,
} from '../entities/saved-shipment.entity';
import { SavedShipmentQuoteSnapshotEntity } from '../entities/saved-shipment-quote-snapshot.entity';
import { CreateShipmentDto } from '../dto/create-shipment.dto';
import { UpdateShipmentDto } from '../dto/update-shipment.dto';
import { ListShipmentsQueryDto } from '../dto/list-shipments-query.dto';
import { RecordSnapshotDto } from '../dto/record-snapshot.dto';

/**
 * Caller context derived from the JWT — required for every public method.
 * Every read/write predicate joins on (organizationId, userId) to prevent
 * cross-tenant leakage.
 */
export interface ShipmentsCtx {
  organizationId: string;
  userId: string;
}

export interface ListShipmentsResult {
  items: SavedShipmentEntity[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SOFT_LIMIT_PER_USER = 500;

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    @InjectRepository(SavedShipmentEntity)
    private readonly shipmentRepo: Repository<SavedShipmentEntity>,
    @InjectRepository(SavedShipmentQuoteSnapshotEntity)
    private readonly snapshotRepo: Repository<SavedShipmentQuoteSnapshotEntity>,
  ) {}

  /**
   * Org-scoped query builder. Returns rows the caller is allowed to see:
   *   - same organization AND (creator is caller OR sharedWithOrg=true)
   *
   * Every read MUST flow through this helper. Direct repository access for
   * cross-tenant queries is a security bug.
   */
  private scoped(ctx: ShipmentsCtx) {
    return this.shipmentRepo
      .createQueryBuilder('s')
      .where('s.organizationId = :org', { org: ctx.organizationId })
      .andWhere(
        new Brackets((qb) => {
          qb.where('s.createdByUserId = :uid', { uid: ctx.userId }).orWhere(
            's.sharedWithOrg = true',
          );
        }),
      );
  }

  async create(ctx: ShipmentsCtx, dto: CreateShipmentDto): Promise<SavedShipmentEntity> {
    const count = await this.shipmentRepo.count({
      where: {
        organizationId: ctx.organizationId,
        createdByUserId: ctx.userId,
        status: 'draft',
      },
    });
    if (count >= SOFT_LIMIT_PER_USER) {
      this.logger.warn(
        `user ${ctx.userId} has ${count} draft shipments (soft limit ${SOFT_LIMIT_PER_USER})`,
      );
    }
    const entity = this.shipmentRepo.create({
      organizationId: ctx.organizationId,
      createdByUserId: ctx.userId,
      name: dto.name,
      description: dto.description ?? null,
      status: dto.status ?? 'draft',
      tags: dto.tags ?? [],
      sharedWithOrg: dto.sharedWithOrg ?? false,
      shipment: dto.shipment,
      lines: dto.lines ?? [],
      lastOpenedAt: new Date(),
      archivedAt: null,
    });
    return this.shipmentRepo.save(entity);
  }

  async list(
    ctx: ShipmentsCtx,
    query: ListShipmentsQueryDto,
  ): Promise<ListShipmentsResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
    const sortColumn =
      query.sort === 'updatedAt'
        ? 's.updatedAt'
        : query.sort === 'createdAt'
          ? 's.createdAt'
          : query.sort === 'name'
            ? 's.name'
            : 's.lastOpenedAt';
    const order: 'ASC' | 'DESC' = (query.order ?? 'desc').toUpperCase() as 'ASC' | 'DESC';

    const qb = this.scoped(ctx);

    if (query.status) {
      qb.andWhere('s.status = :status', { status: query.status });
    } else {
      // Default view excludes archived rows; pass status='archived' explicitly to see them.
      qb.andWhere('s.status != :archivedStatus', { archivedStatus: 'archived' });
    }

    if (query.destination) {
      qb.andWhere("s.shipment->>'destination' = :dest", { dest: query.destination });
    }

    if (query.origin) {
      // Match any line's countryOfOrigin via jsonb path
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM jsonb_array_elements(s.lines) AS line
          WHERE line->>'countryOfOrigin' = :origin
        )`,
        { origin: query.origin },
      );
    }

    if (query.tag) {
      qb.andWhere(':tag = ANY(s.tags)', { tag: query.tag });
    }

    if (query.createdAfter) {
      qb.andWhere('s.createdAt >= :createdAfter', { createdAfter: query.createdAfter });
    }
    if (query.createdBefore) {
      qb.andWhere('s.createdAt <= :createdBefore', { createdBefore: query.createdBefore });
    }

    if (query.q && query.q.trim().length > 0) {
      const like = `%${query.q.trim()}%`;
      qb.andWhere(
        new Brackets((qb2) => {
          qb2
            .where('s.name ILIKE :like', { like })
            .orWhere('COALESCE(s.description, \'\') ILIKE :like', { like })
            .orWhere(
              `EXISTS (
                SELECT 1 FROM jsonb_array_elements(s.lines) AS line
                WHERE line->>'htsNumber' ILIKE :like
                   OR COALESCE(line->>'description', '') ILIKE :like
              )`,
              { like },
            );
        }),
      );
    }

    qb.orderBy(sortColumn, order)
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async findOne(ctx: ShipmentsCtx, id: string, bumpLastOpened = true): Promise<SavedShipmentEntity> {
    const row = await this.scoped(ctx).andWhere('s.id = :id', { id }).getOne();
    if (!row) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }
    if (bumpLastOpened) {
      // Raw SQL on purpose: TypeORM's `.update()` also touches the
      // `@UpdateDateColumn` updatedAt, which would invalidate the
      // If-Match optimistic-concurrency token the client just read.
      // last_opened_at is a read-tracking column, not a write signal.
      await this.shipmentRepo.manager
        .query(
          `UPDATE saved_shipments SET last_opened_at = now() WHERE id = $1 AND organization_id = $2`,
          [row.id, ctx.organizationId],
        )
        .catch((err) =>
          this.logger.warn(`failed to bump lastOpenedAt for ${id}: ${err.message}`),
        );
    }
    return row;
  }

  /**
   * Patch a shipment. When `ifMatchUpdatedAt` is supplied, the update is
   * conditional on the row's updatedAt matching — guards against two-tab
   * autosave clobber. Throws ConflictException on mismatch.
   */
  async update(
    ctx: ShipmentsCtx,
    id: string,
    dto: UpdateShipmentDto,
    ifMatchUpdatedAt?: Date,
  ): Promise<SavedShipmentEntity> {
    const existing = await this.scoped(ctx).andWhere('s.id = :id', { id }).getOne();
    if (!existing) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }
    // Writes are creator-only — sharedWithOrg readers cannot mutate in v1.
    if (existing.createdByUserId !== ctx.userId) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }
    if (
      ifMatchUpdatedAt &&
      existing.updatedAt.getTime() !== ifMatchUpdatedAt.getTime()
    ) {
      throw new ConflictException(
        'Shipment changed in another session. Reload to see the latest version.',
      );
    }

    const patch: Partial<SavedShipmentEntity> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description ?? null;
    if (dto.tags !== undefined) patch.tags = dto.tags;
    if (dto.sharedWithOrg !== undefined) patch.sharedWithOrg = dto.sharedWithOrg;
    if (dto.shipment !== undefined) patch.shipment = dto.shipment;
    if (dto.lines !== undefined) patch.lines = dto.lines;
    if (dto.status !== undefined) {
      patch.status = dto.status;
      patch.archivedAt = dto.status === 'archived' ? new Date() : null;
    }

    Object.assign(existing, patch);
    return this.shipmentRepo.save(existing);
  }

  async archive(ctx: ShipmentsCtx, id: string): Promise<SavedShipmentEntity> {
    return this.update(ctx, id, { status: 'archived' });
  }

  async restore(ctx: ShipmentsCtx, id: string): Promise<SavedShipmentEntity> {
    return this.update(ctx, id, { status: 'draft' });
  }

  async duplicate(ctx: ShipmentsCtx, id: string): Promise<SavedShipmentEntity> {
    const source = await this.findOne(ctx, id, false);
    const copy = this.shipmentRepo.create({
      organizationId: ctx.organizationId,
      createdByUserId: ctx.userId,
      name: `${source.name} (copy)`.slice(0, 200),
      description: source.description,
      status: 'draft',
      tags: [...source.tags],
      sharedWithOrg: false,
      shipment: source.shipment,
      lines: source.lines,
      lastQuoteSnapshot: null,
      lastOpenedAt: new Date(),
      archivedAt: null,
    });
    return this.shipmentRepo.save(copy);
  }

  async recordSnapshot(
    ctx: ShipmentsCtx,
    id: string,
    dto: RecordSnapshotDto,
  ): Promise<SavedShipmentQuoteSnapshotEntity> {
    const shipment = await this.findOne(ctx, id, false);
    // Only the creator can record snapshots in v1; sharedWithOrg readers
    // get a read-only view.
    if (shipment.createdByUserId !== ctx.userId) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }
    const snapshot = this.snapshotRepo.create({
      savedShipmentId: shipment.id,
      organizationId: ctx.organizationId,
      createdByUserId: ctx.userId,
      quoteRequest: dto.quoteRequest,
      quoteResponse: dto.quoteResponse,
      payable: dto.payable !== undefined ? String(dto.payable) : null,
      currency: dto.currency ?? null,
    });
    const saved = await this.snapshotRepo.save(snapshot);

    if (dto.payable !== undefined && dto.currency) {
      const summary: SavedShipmentLastQuoteSnapshot = {
        payable: dto.payable,
        currency: dto.currency,
        calculatedAt: saved.createdAt.toISOString(),
      };
      await this.shipmentRepo.update(
        { id: shipment.id, organizationId: ctx.organizationId },
        { lastQuoteSnapshot: summary },
      );
    }
    return saved;
  }

  async listSnapshots(
    ctx: ShipmentsCtx,
    id: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: SavedShipmentQuoteSnapshotEntity[]; total: number; page: number; pageSize: number }> {
    // Ensure the caller can see the parent shipment before exposing its history.
    await this.findOne(ctx, id, false);
    const take = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
    const skip = (Math.max(1, page) - 1) * take;
    const [items, total] = await this.snapshotRepo.findAndCount({
      where: {
        savedShipmentId: id,
        organizationId: ctx.organizationId,
      },
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
    return { items, total, page: Math.max(1, page), pageSize: take };
  }
}
