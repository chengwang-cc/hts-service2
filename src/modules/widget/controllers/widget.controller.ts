import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  Header,
} from '@nestjs/common';
import type { Response } from 'express';
import { WidgetService } from '../services/widget.service';
import { CreateWidgetDto, UpdateWidgetDto } from '../dto/create-widget.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserEntity } from '../../auth/entities/user.entity';

/**
 * Widget Controller
 * Manage embeddable widgets (requires JWT authentication)
 */
@Controller('widgets')
@UseGuards(JwtAuthGuard)
export class WidgetController {
  constructor(private readonly widgetService: WidgetService) {}

  /**
   * Create a new widget
   */
  @Post()
  async createWidget(
    @Body() createWidgetDto: CreateWidgetDto,
    @CurrentUser() user: UserEntity,
  ) {
    const widget = await this.widgetService.createWidget({
      organizationId: user.organizationId,
      apiKeyId: createWidgetDto.apiKeyId,
      name: createWidgetDto.name,
      widgetType: createWidgetDto.widgetType,
      allowedDomains: createWidgetDto.allowedDomains,
      styling: createWidgetDto.styling,
      features: createWidgetDto.features,
      defaults: createWidgetDto.defaults,
      labels: createWidgetDto.labels,
      createdBy: user.id,
    });

    // Generate embed code
    const embedCode = this.widgetService.generateEmbedCode(widget.widgetId);
    const sdkUrl = this.widgetService.generateSdkUrl(widget.widgetId);

    return {
      widget,
      embedCode,
      sdkUrl,
    };
  }

  /**
   * List all widgets for the organization
   */
  @Get()
  async listWidgets(@CurrentUser() user: UserEntity) {
    return this.widgetService.listWidgets(user.organizationId);
  }

  /**
   * Get widget details
   */
  @Get(':widgetId')
  async getWidget(@Param('widgetId') widgetId: string) {
    const widget = await this.widgetService.getWidget(widgetId);
    const embedCode = this.widgetService.generateEmbedCode(widgetId);
    const sdkUrl = this.widgetService.generateSdkUrl(widgetId);

    return {
      widget,
      embedCode,
      sdkUrl,
    };
  }

  /**
   * Update widget configuration
   */
  @Put(':widgetId')
  async updateWidget(
    @Param('widgetId') widgetId: string,
    @Body() updateWidgetDto: UpdateWidgetDto,
  ) {
    return this.widgetService.updateWidget(widgetId, updateWidgetDto);
  }

  /**
   * Delete widget
   */
  @Delete(':widgetId')
  async deleteWidget(@Param('widgetId') widgetId: string) {
    await this.widgetService.deleteWidget(widgetId);
    return { message: 'Widget deleted successfully' };
  }

  /**
   * Get widget analytics
   */
  @Get(':widgetId/analytics')
  async getAnalytics(
    @Param('widgetId') widgetId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    return this.widgetService.getAnalytics(widgetId, start, end);
  }

  /**
   * Get widget SDK (JavaScript)
   * This endpoint serves the widget SDK JavaScript file
   */
  @Get(':widgetId/sdk.js')
  @Header('Content-Type', 'application/javascript')
  @Header('Cache-Control', 'public, max-age=3600')
  async getWidgetSdk(
    @Param('widgetId') widgetId: string,
    @Res() res: Response,
  ) {
    // Verify widget exists
    await this.widgetService.getWidget(widgetId);

    // Generate SDK JavaScript
    const sdk = this.generateSdkJavaScript(widgetId);

    res.send(sdk);
  }

  /**
   * Generate widget SDK JavaScript
   */
  private generateSdkJavaScript(widgetId: string): string {
    const baseUrl = process.env.PUBLIC_URL || 'https://api.hts-service.com';

    return `
(function(window) {
  'use strict';

  var HTSWidget = {
    config: null,
    sessionId: null,

    init: function(config) {
      this.config = Object.assign({
        widgetId: '${widgetId}',
        containerId: 'hts-widget',
        width: '100%',
        height: '600px',
        baseUrl: '${baseUrl}'
      }, config);

      this.createSession();
      this.render();
    },

    createSession: function() {
      var self = this;
      fetch(self.config.baseUrl + '/api/v1/widget/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          widgetId: self.config.widgetId,
          referrer: window.location.origin,
          pageUrl: window.location.href,
          userAgent: navigator.userAgent
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        self.sessionId = data.sessionId;
      })
      .catch(function(err) {
        console.error('Failed to create widget session:', err);
      });
    },

    render: function() {
      var container = document.getElementById(this.config.containerId);
      if (!container) {
        console.error('Widget container not found:', this.config.containerId);
        return;
      }

      var iframe = document.createElement('iframe');
      iframe.src = this.config.baseUrl + '/widget/' + this.config.widgetId + '/embed';
      iframe.style.width = this.config.width;
      iframe.style.height = this.config.height;
      iframe.style.border = 'none';
      iframe.style.display = 'block';

      container.appendChild(iframe);

      // Track render event
      this.track('view', { widgetId: this.config.widgetId });
    },

    track: function(eventType, data) {
      if (!this.sessionId) return;

      fetch(this.config.baseUrl + '/api/v1/widget/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          type: eventType,
          data: data
        })
      })
      .catch(function(err) {
        console.error('Failed to track event:', err);
      });
    }
  };

  window.HTSWidget = HTSWidget;

})(window);
`.trim();
  }
}
