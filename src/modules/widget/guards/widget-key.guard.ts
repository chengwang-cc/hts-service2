import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WidgetConfigEntity } from '../entities/widget-config.entity';
import { ShopifySessionEntity } from '../../shopify-app/entities/shopify-session.entity';
import { ShopifyAuthService } from '../../shopify-app/services/shopify-auth.service';

/**
 * Accepts either:
 * 1. X-Widget-Key header → validates against WidgetConfigEntity
 * 2. Authorization: Bearer <shopify-session-token> → validates Shopify session token
 */
@Injectable()
export class WidgetKeyGuard implements CanActivate {
  private readonly logger = new Logger(WidgetKeyGuard.name);

  constructor(
    @InjectRepository(WidgetConfigEntity)
    private readonly widgetConfigRepository: Repository<WidgetConfigEntity>,
    @InjectRepository(ShopifySessionEntity)
    private readonly shopifySessionRepository: Repository<ShopifySessionEntity>,
    private readonly shopifyAuthService: ShopifyAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Try X-Widget-Key first
    const widgetKey = request.headers['x-widget-key'];
    if (widgetKey) {
      const widget = await this.widgetConfigRepository.findOne({
        where: { widgetId: widgetKey, isActive: true },
      });

      if (!widget) {
        throw new UnauthorizedException('Invalid or inactive widget key');
      }

      request.widgetConfig = widget;
      request.organizationId = widget.organizationId;
      return true;
    }

    // Try Shopify session token (Bearer)
    const authHeader = request.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const { shop } = this.shopifyAuthService.verifySessionToken(token);
        const session = await this.shopifySessionRepository.findOne({
          where: { shop, isActive: true },
        });

        if (session) {
          request.shopifySession = session;
          request.organizationId = session.organizationId;
          return true;
        }
      } catch (error) {
        this.logger.warn(`Shopify session token rejected: ${error.message}`);
      }
    }

    throw new UnauthorizedException(
      'Authentication required: provide X-Widget-Key header or Shopify session token',
    );
  }
}
