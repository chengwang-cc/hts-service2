import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PLANS, PlanFeatures, OVERAGE_RATES } from '../config/plans.config';

export interface EntitlementResult {
  allowed: boolean;
  remaining: number | null; // null for boolean features, -1 for unlimited
  usage?: number;
  quota?: number;
  message?: string;
}

@Injectable()
export class EntitlementService {
  constructor() {}

  /**
   * Check if organization has access to a feature
   */
  async checkEntitlement(
    plan: string,
    currentUsage: Record<string, number>,
    feature: string,
    action: 'check' | 'consume' = 'check',
  ): Promise<EntitlementResult> {
    const planConfig = PLANS[plan];

    if (!planConfig) {
      throw new Error(`Unknown plan: ${plan}`);
    }

    // Parse feature path (e.g., 'classifications.monthly', 'api.webhooks')
    const [category, featureKey] = feature.split('.');
    const features = planConfig.features as any;
    const featureConfig = features[category]?.[featureKey];

    if (featureConfig === undefined) {
      throw new Error(`Unknown feature: ${feature}`);
    }

    // Boolean features (e.g., webhooks, customBranding)
    if (typeof featureConfig === 'boolean') {
      return {
        allowed: featureConfig,
        remaining: null,
        message: featureConfig ? undefined : `Feature ${feature} not available in ${plan} plan`,
      };
    }

    // Nested object features (e.g., rateLimit)
    if (typeof featureConfig === 'object' && !Array.isArray(featureConfig)) {
      // For objects like rateLimit, return the entire object
      return {
        allowed: true,
        remaining: null,
      };
    }

    // Array features (e.g., exportFormats)
    if (Array.isArray(featureConfig)) {
      return {
        allowed: true,
        remaining: null,
      };
    }

    // Numeric quota features (e.g., monthly limits)
    if (typeof featureConfig === 'number') {
      const usage = currentUsage[feature] || 0;
      const quota = featureConfig;

      // Unlimited (-1)
      if (quota === -1) {
        return {
          allowed: true,
          remaining: -1,
          usage,
          quota: -1,
        };
      }

      // Check quota
      const allowed = usage < quota;

      return {
        allowed,
        remaining: Math.max(0, quota - usage),
        usage,
        quota,
        message: allowed ? undefined : `Quota exceeded for ${feature}. Current: ${usage}, Limit: ${quota}`,
      };
    }

    // String features (e.g., support level)
    if (typeof featureConfig === 'string') {
      return {
        allowed: true,
        remaining: null,
      };
    }

    return {
      allowed: false,
      remaining: null,
      message: `Cannot determine entitlement for ${feature}`,
    };
  }

  /**
   * Check and throw if not entitled
   */
  async requireEntitlement(
    plan: string,
    currentUsage: Record<string, number>,
    feature: string,
  ): Promise<void> {
    const result = await this.checkEntitlement(plan, currentUsage, feature, 'check');

    if (!result.allowed) {
      throw new ForbiddenException(
        result.message || `Access denied: ${feature} not available in your plan`,
      );
    }
  }

  /**
   * Get all features for a plan
   */
  async getPlanFeatures(plan: string): Promise<PlanFeatures> {
    const planConfig = PLANS[plan];

    if (!planConfig) {
      throw new Error(`Unknown plan: ${plan}`);
    }

    return planConfig.features;
  }

  /**
   * Calculate overage charges
   */
  async calculateOverages(
    plan: string,
    currentUsage: Record<string, number>,
  ): Promise<{
    overages: Array<{
      metric: string;
      usage: number;
      quota: number;
      overage: number;
      rate: number;
      charge: number;
    }>;
    totalCharge: number;
  }> {
    const planConfig = PLANS[plan];

    if (!planConfig) {
      throw new Error(`Unknown plan: ${plan}`);
    }

    const overages: Array<{
      metric: string;
      usage: number;
      quota: number;
      overage: number;
      rate: number;
      charge: number;
    }> = [];

    // Check each metric that has overage rates
    for (const [metric, rate] of Object.entries(OVERAGE_RATES)) {
      const usage = currentUsage[metric] || 0;

      // Get quota from plan
      const [category, featureKey] = metric.split('.');
      const features = planConfig.features as any;
      const quota = features[category]?.[featureKey];

      if (typeof quota === 'number' && quota !== -1 && usage > quota) {
        const overage = usage - quota;
        const charge = overage * rate;

        overages.push({
          metric,
          usage,
          quota,
          overage,
          rate,
          charge,
        });
      }
    }

    const totalCharge = overages.reduce((sum, o) => sum + o.charge, 0);

    return {
      overages,
      totalCharge,
    };
  }

  /**
   * Check if plan upgrade is needed
   */
  async suggestPlanUpgrade(
    currentPlan: string,
    currentUsage: Record<string, number>,
  ): Promise<{
    shouldUpgrade: boolean;
    suggestedPlan?: string;
    reasons: string[];
  }> {
    const reasons: string[] = [];
    let suggestedPlan: string | undefined;

    const planConfig = PLANS[currentPlan];
    if (!planConfig) {
      return { shouldUpgrade: false, reasons };
    }

    // Check if hitting limits frequently
    const features = planConfig.features;

    // Check classifications
    if (
      features.classifications.monthly !== -1 &&
      currentUsage['classifications.monthly'] >= features.classifications.monthly * 0.9
    ) {
      reasons.push('Approaching classification limit');
    }

    // Check calculations
    if (
      features.calculations.monthly !== -1 &&
      currentUsage['calculations.monthly'] >= features.calculations.monthly * 0.9
    ) {
      reasons.push('Approaching calculation limit');
    }

    // Check API requests
    if (
      features.api.requestsPerMonth !== -1 &&
      currentUsage['api.requestsPerMonth'] >= features.api.requestsPerMonth * 0.9
    ) {
      reasons.push('Approaching API request limit');
    }

    if (reasons.length > 0) {
      // Suggest next tier
      const tiers = ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'];
      const currentIndex = tiers.indexOf(currentPlan);
      if (currentIndex < tiers.length - 1) {
        suggestedPlan = tiers[currentIndex + 1];
      }
    }

    return {
      shouldUpgrade: reasons.length > 0,
      suggestedPlan,
      reasons,
    };
  }

  /**
   * Compare two plans
   */
  async comparePlans(
    plan1: string,
    plan2: string,
  ): Promise<{
    plan1: string;
    plan2: string;
    differences: Array<{
      feature: string;
      plan1Value: any;
      plan2Value: any;
      better: 'plan1' | 'plan2' | 'same';
    }>;
  }> {
    const config1 = PLANS[plan1];
    const config2 = PLANS[plan2];

    if (!config1 || !config2) {
      throw new Error('Invalid plan comparison');
    }

    const differences: Array<{
      feature: string;
      plan1Value: any;
      plan2Value: any;
      better: 'plan1' | 'plan2' | 'same';
    }> = [];

    // Compare numeric features
    const numericFeatures = [
      'classifications.monthly',
      'calculations.monthly',
      'api.requestsPerMonth',
      'widget.calculationsPerMonth',
      'team.maxUsers',
      'data.dataRetentionDays',
    ];

    for (const feature of numericFeatures) {
      const [category, key] = feature.split('.');
      const val1 = (config1.features as any)[category][key];
      const val2 = (config2.features as any)[category][key];

      let better: 'plan1' | 'plan2' | 'same' = 'same';
      if (val1 === -1 && val2 !== -1) better = 'plan1';
      else if (val2 === -1 && val1 !== -1) better = 'plan2';
      else if (val1 > val2) better = 'plan1';
      else if (val2 > val1) better = 'plan2';

      differences.push({
        feature,
        plan1Value: val1,
        plan2Value: val2,
        better,
      });
    }

    return {
      plan1,
      plan2,
      differences,
    };
  }
}
