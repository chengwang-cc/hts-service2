import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnboardingProgressEntity } from '../entities/onboarding-progress.entity';
import {
  StartOnboardingDto,
  UpdateOnboardingStepDto,
} from '../dto/onboarding.dto';

export interface OnboardingFlow {
  persona: 'merchant' | 'broker' | 'developer';
  steps: Array<{
    id: string;
    title: string;
    description: string;
    required: boolean;
    order: number;
  }>;
}

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(OnboardingProgressEntity)
    private readonly progressRepo: Repository<OnboardingProgressEntity>,
  ) {}

  private readonly flows: Record<string, OnboardingFlow> = {
    merchant: {
      persona: 'merchant',
      steps: [
        {
          id: 'welcome',
          title: 'Welcome',
          description: 'Introduction to the platform',
          required: true,
          order: 1,
        },
        {
          id: 'organization-setup',
          title: 'Organization Setup',
          description: 'Configure your company details',
          required: true,
          order: 2,
        },
        {
          id: 'product-import',
          title: 'Import Products',
          description: 'Upload your product catalog',
          required: true,
          order: 3,
        },
        {
          id: 'sku-mapping',
          title: 'Map SKUs',
          description: 'Map products to HTS codes',
          required: true,
          order: 4,
        },
        {
          id: 'widget-setup',
          title: 'Install Widget',
          description: 'Add calculator to your store',
          required: false,
          order: 5,
        },
        {
          id: 'first-calculation',
          title: 'First Calculation',
          description: 'Test the calculator',
          required: true,
          order: 6,
        },
      ],
    },
    broker: {
      persona: 'broker',
      steps: [
        {
          id: 'welcome',
          title: 'Welcome',
          description: 'Introduction to the platform',
          required: true,
          order: 1,
        },
        {
          id: 'organization-setup',
          title: 'Organization Setup',
          description: 'Configure your company details',
          required: true,
          order: 2,
        },
        {
          id: 'client-workspaces',
          title: 'Client Workspaces',
          description: 'Set up multi-client management',
          required: true,
          order: 3,
        },
        {
          id: 'approval-workflow',
          title: 'Approval Workflow',
          description: 'Configure classification approvals',
          required: true,
          order: 4,
        },
        {
          id: 'export-templates',
          title: 'Export Templates',
          description: 'Set up broker export formats',
          required: false,
          order: 5,
        },
        {
          id: 'first-classification',
          title: 'First Classification',
          description: 'Classify and approve an item',
          required: true,
          order: 6,
        },
      ],
    },
    developer: {
      persona: 'developer',
      steps: [
        {
          id: 'welcome',
          title: 'Welcome',
          description: 'Introduction to the API',
          required: true,
          order: 1,
        },
        {
          id: 'organization-setup',
          title: 'Organization Setup',
          description: 'Configure your organization',
          required: true,
          order: 2,
        },
        {
          id: 'api-key-creation',
          title: 'Create API Key',
          description: 'Generate your first API key',
          required: true,
          order: 3,
        },
        {
          id: 'interactive-docs',
          title: 'Explore API Docs',
          description: 'Try the interactive documentation',
          required: false,
          order: 4,
        },
        {
          id: 'first-api-call',
          title: 'First API Call',
          description: 'Make your first classification request',
          required: true,
          order: 5,
        },
        {
          id: 'webhook-setup',
          title: 'Webhooks',
          description: 'Configure webhooks (optional)',
          required: false,
          order: 6,
        },
      ],
    },
  };

  async startOnboarding(
    organizationId: string,
    userId: string,
    dto: StartOnboardingDto,
  ): Promise<OnboardingProgressEntity> {
    // Check if onboarding already exists
    let progress = await this.progressRepo.findOne({
      where: { organizationId, userId },
    });

    if (progress) {
      // Reset if changing persona
      if (progress.persona !== dto.persona) {
        progress.persona = dto.persona;
        progress.currentStep = this.flows[dto.persona].steps[0].id;
        progress.completedSteps = {};
        progress.isComplete = false;
        progress.completedAt = null;
        progress.wizardData = dto.initialData || {};
      }
    } else {
      // Create new progress
      progress = this.progressRepo.create({
        organizationId,
        userId,
        persona: dto.persona,
        currentStep: this.flows[dto.persona].steps[0].id,
        completedSteps: {},
        wizardData: dto.initialData || {},
        isComplete: false,
      });
    }

    return this.progressRepo.save(progress);
  }

  async getProgress(
    organizationId: string,
    userId: string,
  ): Promise<OnboardingProgressEntity | null> {
    return this.progressRepo.findOne({
      where: { organizationId, userId },
    });
  }

  async updateStep(
    organizationId: string,
    userId: string,
    dto: UpdateOnboardingStepDto,
  ): Promise<OnboardingProgressEntity> {
    const progress = await this.progressRepo.findOne({
      where: { organizationId, userId },
    });

    if (!progress) {
      throw new Error('Onboarding not started');
    }

    const flow = this.flows[progress.persona];
    const step = flow.steps.find((s) => s.id === dto.step);

    if (!step) {
      throw new Error('Invalid step');
    }

    // Update wizard data
    if (dto.data) {
      progress.wizardData = {
        ...progress.wizardData,
        [dto.step]: dto.data,
      };
    }

    // Mark step as completed
    if (dto.complete) {
      progress.completedSteps = {
        ...progress.completedSteps,
        [dto.step]: {
          completedAt: new Date().toISOString(),
          metadata: dto.data,
        },
      };

      // Move to next step
      const currentIndex = flow.steps.findIndex((s) => s.id === dto.step);
      if (currentIndex < flow.steps.length - 1) {
        progress.currentStep = flow.steps[currentIndex + 1].id;
      } else {
        // All steps completed
        progress.isComplete = true;
        progress.completedAt = new Date();
      }
    } else {
      progress.currentStep = dto.step;
    }

    return this.progressRepo.save(progress);
  }

  getFlow(persona: 'merchant' | 'broker' | 'developer'): OnboardingFlow {
    return this.flows[persona];
  }

  async getProgressSummary(
    organizationId: string,
    userId: string,
  ): Promise<{
    flow: OnboardingFlow;
    progress: OnboardingProgressEntity | null;
    completionPercentage: number;
    currentStepIndex: number;
    nextStep: string | null;
  }> {
    const progress = await this.getProgress(organizationId, userId);

    if (!progress) {
      return {
        flow: this.flows.merchant, // Default to merchant
        progress: null,
        completionPercentage: 0,
        currentStepIndex: 0,
        nextStep: null,
      };
    }

    const flow = this.flows[progress.persona];
    const completedCount = Object.keys(progress.completedSteps).length;
    const totalSteps = flow.steps.filter((s) => s.required).length;
    const completionPercentage = Math.round(
      (completedCount / totalSteps) * 100,
    );

    const currentStepIndex = flow.steps.findIndex(
      (s) => s.id === progress.currentStep,
    );
    const nextStep =
      currentStepIndex < flow.steps.length - 1
        ? flow.steps[currentStepIndex + 1].id
        : null;

    return {
      flow,
      progress,
      completionPercentage,
      currentStepIndex,
      nextStep,
    };
  }
}
