import { Injectable, Logger } from '@nestjs/common';
import { WebScrapingService } from '../../services/web-scraping.service';
import { createFetchPageTool } from '../tools/fetch-page.tool';
import { createScrapePageTool } from '../tools/scrape-page.tool';
import { createScreenshotTool } from '../tools/screenshot.tool';

/**
 * Puppeteer MCP Server
 * Exposes web scraping operations as MCP tools for OpenAI Agent
 */
@Injectable()
export class PuppeteerMCPServer {
  private readonly logger = new Logger(PuppeteerMCPServer.name);
  private tools: Map<string, any> = new Map();
  private isInitialized = false;

  constructor(private readonly webScrapingService: WebScrapingService) {}

  /**
   * Initialize MCP server and register tools
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('MCP server already initialized');
      return;
    }

    this.logger.log('Initializing Puppeteer MCP server...');

    try {
      // Register tools
      const fetchPageTool = createFetchPageTool(this.webScrapingService);
      const scrapePageTool = createScrapePageTool(this.webScrapingService);
      const screenshotTool = createScreenshotTool(this.webScrapingService);

      this.tools.set(fetchPageTool.name, fetchPageTool);
      this.tools.set(scrapePageTool.name, scrapePageTool);
      this.tools.set(screenshotTool.name, screenshotTool);

      this.isInitialized = true;
      this.logger.log(
        `MCP server initialized with ${this.tools.size} tools: ${Array.from(this.tools.keys()).join(', ')}`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize MCP server', error.stack);
      throw new Error('MCP server initialization failed');
    }
  }

  /**
   * Get all available tools
   */
  getTools(): any[] {
    if (!this.isInitialized) {
      throw new Error('MCP server not initialized');
    }

    return Array.from(this.tools.values());
  }

  /**
   * Get tool definitions for OpenAI Agent
   * Converts MCP tool format to OpenAI tool schema
   */
  getToolDefinitions(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: any;
    };
  }> {
    if (!this.isInitialized) {
      throw new Error('MCP server not initialized');
    }

    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Execute a tool by name
   */
  async executeTool(toolName: string, params: any): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('MCP server not initialized');
    }

    const tool = this.tools.get(toolName);

    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    this.logger.log(`Executing tool: ${toolName}`);

    try {
      const result = await tool.handler(params);
      this.logger.log(`Tool ${toolName} executed successfully`);
      return result;
    } catch (error) {
      this.logger.error(`Tool ${toolName} execution failed`, error.stack);
      throw new Error(`Tool execution failed: ${error.message}`);
    }
  }

  /**
   * Get server status
   */
  getStatus(): {
    initialized: boolean;
    toolCount: number;
    availableTools: string[];
  } {
    return {
      initialized: this.isInitialized,
      toolCount: this.tools.size,
      availableTools: Array.from(this.tools.keys()),
    };
  }
}
