import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { WidgetConfigEntity } from '../entities/widget-config.entity';
import { WidgetSessionEntity } from '../entities/widget-session.entity';

/**
 * Widget Service
 * Manages embeddable widgets for organizations
 */
@Injectable()
export class WidgetService {
  private readonly logger = new Logger(WidgetService.name);

  constructor(
    @InjectRepository(WidgetConfigEntity)
    private readonly widgetConfigRepository: Repository<WidgetConfigEntity>,
    @InjectRepository(WidgetSessionEntity)
    private readonly widgetSessionRepository: Repository<WidgetSessionEntity>,
  ) {}

  /**
   * Create a new widget configuration
   */
  async createWidget(params: {
    organizationId: string;
    apiKeyId: string;
    name: string;
    widgetType: 'lookup' | 'calculator' | 'combined';
    allowedDomains: string[];
    styling?: any;
    features?: any;
    defaults?: any;
    labels?: any;
    createdBy?: string;
  }): Promise<WidgetConfigEntity> {
    // Generate unique widget ID
    const widgetId = this.generateWidgetId();

    const widget = this.widgetConfigRepository.create({
      widgetId,
      name: params.name,
      organizationId: params.organizationId,
      apiKeyId: params.apiKeyId,
      widgetType: params.widgetType,
      allowedDomains: params.allowedDomains,
      styling: params.styling || null,
      features: params.features || {
        showDescription: true,
        showRates: true,
        enableSearch: true,
        maxResults: 10,
      },
      defaults: params.defaults || null,
      labels: params.labels || null,
      createdBy: params.createdBy || null,
      isActive: true,
      analyticsEnabled: true,
      rateLimitPerDay: 1000,
    });

    const saved = await this.widgetConfigRepository.save(widget);

    this.logger.log(
      `Created widget ${widgetId} for organization ${params.organizationId}`,
    );

    return saved;
  }

  /**
   * Get widget configuration by widget ID
   */
  async getWidget(widgetId: string): Promise<WidgetConfigEntity> {
    const widget = await this.widgetConfigRepository.findOne({
      where: { widgetId },
      relations: ['apiKey'],
    });

    if (!widget) {
      throw new NotFoundException(`Widget ${widgetId} not found`);
    }

    return widget;
  }

  /**
   * List widgets for an organization
   */
  async listWidgets(organizationId: string): Promise<WidgetConfigEntity[]> {
    return this.widgetConfigRepository.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Update widget configuration
   */
  async updateWidget(
    widgetId: string,
    updates: Partial<WidgetConfigEntity>,
  ): Promise<WidgetConfigEntity> {
    const widget = await this.getWidget(widgetId);

    // Prevent changing critical fields
    delete updates['widgetId'];
    delete updates['organizationId'];
    delete updates['createdAt'];

    Object.assign(widget, updates);

    return this.widgetConfigRepository.save(widget);
  }

  /**
   * Delete (deactivate) a widget
   */
  async deleteWidget(widgetId: string): Promise<void> {
    await this.widgetConfigRepository.update(
      { widgetId },
      { isActive: false },
    );

    this.logger.log(`Deactivated widget ${widgetId}`);
  }

  /**
   * Generate widget embed code
   */
  generateEmbedCode(
    widgetId: string,
    options?: {
      width?: string;
      height?: string;
      containerId?: string;
    },
  ): string {
    const baseUrl = process.env.PUBLIC_URL || 'https://api.hts-service.com';
    const width = options?.width || '100%';
    const height = options?.height || '600px';
    const containerId = options?.containerId || 'hts-widget';

    // Generate JavaScript embed code
    const embedCode = `
<!-- HTS Widget -->
<div id="${containerId}"></div>
<script>
(function() {
  var script = document.createElement('script');
  script.src = '${baseUrl}/widget/${widgetId}/sdk.js';
  script.async = true;
  script.onload = function() {
    HTSWidget.init({
      widgetId: '${widgetId}',
      containerId: '${containerId}',
      width: '${width}',
      height: '${height}'
    });
  };
  document.head.appendChild(script);
})();
</script>
<!-- End HTS Widget -->
`.trim();

    return embedCode;
  }

  /**
   * Generate widget SDK URL
   */
  generateSdkUrl(widgetId: string): string {
    const baseUrl = process.env.PUBLIC_URL || 'https://api.hts-service.com';
    return `${baseUrl}/widget/${widgetId}/sdk.js`;
  }

  /**
   * Create a widget session
   */
  async createSession(params: {
    widgetId: string;
    referrer: string;
    pageUrl: string;
    userAgent?: string;
    clientIp?: string;
  }): Promise<WidgetSessionEntity> {
    // Get widget config
    const widget = await this.getWidget(params.widgetId);

    // Verify referrer is allowed
    if (!this.isAllowedDomain(params.referrer, widget.allowedDomains)) {
      throw new Error(`Domain ${params.referrer} not allowed for this widget`);
    }

    // Generate session ID
    const sessionId = this.generateSessionId();

    const session = this.widgetSessionRepository.create({
      sessionId,
      widgetConfigId: widget.id,
      widgetId: widget.widgetId,
      organizationId: widget.organizationId,
      referrer: params.referrer,
      pageUrl: params.pageUrl,
      userAgent: params.userAgent || null,
      clientIp: params.clientIp || null,
      interactionCount: 0,
      interactions: [],
    });

    return this.widgetSessionRepository.save(session);
  }

  /**
   * Track widget interaction
   */
  async trackInteraction(
    sessionId: string,
    interaction: {
      type: 'search' | 'lookup' | 'calculate' | 'view';
      data: any;
    },
  ): Promise<void> {
    const session = await this.widgetSessionRepository.findOne({
      where: { sessionId },
    });

    if (!session) {
      this.logger.warn(`Session ${sessionId} not found for interaction tracking`);
      return;
    }

    // Add interaction
    const interactions = session.interactions || [];
    interactions.push({
      ...interaction,
      timestamp: new Date().toISOString(),
    });

    // Update session
    await this.widgetSessionRepository.update(session.id, {
      interactions,
      interactionCount: interactions.length,
    });
  }

  /**
   * End a widget session
   */
  async endSession(sessionId: string): Promise<void> {
    const session = await this.widgetSessionRepository.findOne({
      where: { sessionId },
    });

    if (!session) {
      return;
    }

    const now = new Date();
    const durationSeconds = Math.floor(
      (now.getTime() - session.createdAt.getTime()) / 1000,
    );

    await this.widgetSessionRepository.update(session.id, {
      endedAt: now,
      durationSeconds,
    });
  }

  /**
   * Get widget analytics
   */
  async getAnalytics(
    widgetId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any> {
    const sessions = await this.widgetSessionRepository
      .createQueryBuilder('session')
      .where('session.widgetId = :widgetId', { widgetId })
      .andWhere('session.createdAt >= :startDate', { startDate })
      .andWhere('session.createdAt <= :endDate', { endDate })
      .getMany();

    const totalSessions = sessions.length;
    const totalInteractions = sessions.reduce(
      (sum, s) => sum + s.interactionCount,
      0,
    );
    const avgDuration =
      sessions.filter((s) => s.durationSeconds !== null).reduce(
        (sum, s) => sum + (s.durationSeconds || 0),
        0,
      ) / totalSessions || 0;

    // Group by domain
    const byDomain: Record<string, number> = {};
    sessions.forEach((s) => {
      byDomain[s.referrer] = (byDomain[s.referrer] || 0) + 1;
    });

    // Group by interaction type
    const byInteractionType: Record<string, number> = {};
    sessions.forEach((s) => {
      (s.interactions || []).forEach((i) => {
        byInteractionType[i.type] = (byInteractionType[i.type] || 0) + 1;
      });
    });

    return {
      totalSessions,
      totalInteractions,
      avgDuration,
      byDomain,
      byInteractionType,
    };
  }

  /**
   * Generate a unique widget ID
   */
  private generateWidgetId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `widget_${timestamp}_${random}`;
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(12).toString('hex');
    return `session_${timestamp}_${random}`;
  }

  /**
   * Check if a domain is allowed
   */
  private isAllowedDomain(referrer: string, allowedDomains: string[]): boolean {
    if (!referrer) return false;

    // Extract domain from referrer
    let domain: string;
    try {
      const url = new URL(referrer);
      domain = url.origin;
    } catch {
      return false;
    }

    // Check if domain is in allowed list
    return allowedDomains.some((allowed) => {
      // Exact match
      if (allowed === domain) return true;

      // Wildcard match (e.g., *.example.com)
      if (allowed.includes('*')) {
        const regex = new RegExp(
          '^' + allowed.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$',
        );
        return regex.test(domain);
      }

      return false;
    });
  }
}
