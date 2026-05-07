import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ShopifyAuthService } from '../services/shopify-auth.service';

@Injectable()
export class ShopifySessionGuard implements CanActivate {
  private readonly logger = new Logger(ShopifySessionGuard.name);

  constructor(private readonly shopifyAuthService: ShopifyAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Shopify session token');
    }

    const token = authHeader.substring(7);

    let shop: string;
    try {
      const result = this.shopifyAuthService.verifySessionToken(token);
      shop = result.shop;
    } catch (error) {
      this.logger.warn(`Session token verification failed: ${error.message}`);
      throw new UnauthorizedException(error.message || 'Invalid session token');
    }

    const session = await this.shopifyAuthService.getSession(shop);
    if (!session) {
      this.logger.warn(`No active session for shop: ${shop}`);
      throw new UnauthorizedException('No active session for this shop. Please reinstall the app.');
    }

    request.shopifySession = session;
    request.shopifyShop = shop;

    return true;
  }
}
