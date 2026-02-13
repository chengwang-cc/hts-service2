import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  OnboardingService,
  TemplateService,
  StartOnboardingDto,
  UpdateOnboardingStepDto,
  GenerateTemplateDto,
  ValidateCsvDto,
} from '@hts/onboarding';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly templateService: TemplateService,
  ) {}

  /**
   * Start onboarding wizard
   */
  @Post('start')
  async startOnboarding(
    @CurrentUser() user: any,
    @Body() dto: StartOnboardingDto,
  ) {
    return this.onboardingService.startOnboarding(
      user.organizationId,
      user.id,
      dto,
    );
  }

  /**
   * Get current onboarding progress
   */
  @Get('progress')
  async getProgress(@CurrentUser() user: any) {
    const progress = await this.onboardingService.getProgress(
      user.organizationId,
      user.id,
    );

    if (!progress) {
      return {
        started: false,
        progress: null,
      };
    }

    const summary = await this.onboardingService.getProgressSummary(
      user.organizationId,
      user.id,
    );

    return {
      started: true,
      ...summary,
    };
  }

  /**
   * Update onboarding step
   */
  @Patch('step')
  async updateStep(
    @CurrentUser() user: any,
    @Body() dto: UpdateOnboardingStepDto,
  ) {
    return this.onboardingService.updateStep(
      user.organizationId,
      user.id,
      dto,
    );
  }

  /**
   * Get flow for a persona
   */
  @Get('flow/:persona')
  async getFlow(@CurrentUser() user: any, @Body('persona') persona: string) {
    if (!['merchant', 'broker', 'developer'].includes(persona)) {
      throw new HttpException('Invalid persona', HttpStatus.BAD_REQUEST);
    }

    return this.onboardingService.getFlow(
      persona as 'merchant' | 'broker' | 'developer',
    );
  }

  /**
   * Generate CSV template
   */
  @Post('templates/generate')
  async generateTemplate(@Body() dto: GenerateTemplateDto) {
    const csv = await this.templateService.generateTemplate(dto);

    return {
      templateType: dto.templateType,
      csv,
      downloadUrl: null, // Could generate a temporary download link
    };
  }

  /**
   * Validate CSV upload
   */
  @Post('templates/validate')
  async validateCsv(@Body() dto: ValidateCsvDto) {
    return this.templateService.validateCsv(dto);
  }

  /**
   * List available templates
   */
  @Get('templates')
  async listTemplates() {
    return this.templateService.getAllBuiltInTemplates();
  }

  /**
   * Get template info
   */
  @Get('templates/:type')
  async getTemplateInfo(@Body('type') type: string) {
    const template = this.templateService.getBuiltInTemplateInfo(type);

    if (!template) {
      throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
    }

    return template;
  }
}
