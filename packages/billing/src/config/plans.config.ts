export interface PlanFeatures {
  classifications: {
    monthly: number; // -1 = unlimited
    aiConfidence: boolean;
    bulkUpload: boolean;
    imageClassification: boolean;
  };
  calculations: {
    monthly: number;
    scenarioComparison: boolean;
    advancedBreakdown: boolean;
  };
  api: {
    requestsPerMonth: number;
    rateLimit: { perMinute: number; perDay: number };
    webhooks: boolean;
  };
  widget: {
    enabled: boolean;
    calculationsPerMonth: number;
    customBranding: boolean;
    analyticsEnabled: boolean;
  };
  data: {
    dataRetentionDays: number; // -1 = forever
    exportFormats: string[];
    auditPacks: boolean;
  };
  support: {
    level: 'community' | 'email' | 'priority' | 'dedicated';
    responseTimeSLA?: string;
  };
  team: {
    maxUsers: number; // -1 = unlimited
    roleBasedAccess: boolean;
    auditLogs: boolean;
  };
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  price: {
    monthly: number;
    yearly: number;
  };
  stripePriceIds: {
    monthly?: string;
    yearly?: string;
  };
  features: PlanFeatures;
  popular?: boolean;
}

export const PLANS: Record<string, Plan> = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    description: 'Perfect for trying out HTS classification',
    price: {
      monthly: 0,
      yearly: 0,
    },
    stripePriceIds: {},
    features: {
      classifications: {
        monthly: 10,
        aiConfidence: false,
        bulkUpload: false,
        imageClassification: false,
      },
      calculations: {
        monthly: 50,
        scenarioComparison: false,
        advancedBreakdown: false,
      },
      api: {
        requestsPerMonth: 1000,
        rateLimit: { perMinute: 10, perDay: 1000 },
        webhooks: false,
      },
      widget: {
        enabled: false,
        calculationsPerMonth: 0,
        customBranding: false,
        analyticsEnabled: false,
      },
      data: {
        dataRetentionDays: 30,
        exportFormats: ['csv'],
        auditPacks: false,
      },
      support: {
        level: 'community',
      },
      team: {
        maxUsers: 1,
        roleBasedAccess: false,
        auditLogs: false,
      },
    },
  },

  STARTER: {
    id: 'STARTER',
    name: 'Starter',
    description: 'For small businesses getting started with imports',
    price: {
      monthly: 49,
      yearly: 470, // ~20% discount
    },
    stripePriceIds: {
      // These will be filled in with actual Stripe price IDs
      monthly: 'price_starter_monthly',
      yearly: 'price_starter_yearly',
    },
    features: {
      classifications: {
        monthly: 100,
        aiConfidence: true,
        bulkUpload: true,
        imageClassification: false,
      },
      calculations: {
        monthly: 500,
        scenarioComparison: true,
        advancedBreakdown: true,
      },
      api: {
        requestsPerMonth: 10000,
        rateLimit: { perMinute: 60, perDay: 10000 },
        webhooks: false,
      },
      widget: {
        enabled: true,
        calculationsPerMonth: 500,
        customBranding: false,
        analyticsEnabled: true,
      },
      data: {
        dataRetentionDays: 90,
        exportFormats: ['csv', 'excel'],
        auditPacks: false,
      },
      support: {
        level: 'email',
        responseTimeSLA: '48 hours',
      },
      team: {
        maxUsers: 3,
        roleBasedAccess: true,
        auditLogs: false,
      },
    },
  },

  PROFESSIONAL: {
    id: 'PROFESSIONAL',
    name: 'Professional',
    description: 'For growing businesses with higher volume',
    price: {
      monthly: 199,
      yearly: 1910, // ~20% discount
    },
    stripePriceIds: {
      monthly: 'price_professional_monthly',
      yearly: 'price_professional_yearly',
    },
    popular: true,
    features: {
      classifications: {
        monthly: 1000,
        aiConfidence: true,
        bulkUpload: true,
        imageClassification: true,
      },
      calculations: {
        monthly: 5000,
        scenarioComparison: true,
        advancedBreakdown: true,
      },
      api: {
        requestsPerMonth: 100000,
        rateLimit: { perMinute: 120, perDay: 100000 },
        webhooks: true,
      },
      widget: {
        enabled: true,
        calculationsPerMonth: 5000,
        customBranding: true,
        analyticsEnabled: true,
      },
      data: {
        dataRetentionDays: 365,
        exportFormats: ['csv', 'excel', 'pdf'],
        auditPacks: true,
      },
      support: {
        level: 'priority',
        responseTimeSLA: '24 hours',
      },
      team: {
        maxUsers: 10,
        roleBasedAccess: true,
        auditLogs: true,
      },
    },
  },

  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'For large organizations with custom needs',
    price: {
      monthly: 999,
      yearly: 9590, // ~20% discount
    },
    stripePriceIds: {
      monthly: 'price_enterprise_monthly',
      yearly: 'price_enterprise_yearly',
    },
    features: {
      classifications: {
        monthly: -1, // unlimited
        aiConfidence: true,
        bulkUpload: true,
        imageClassification: true,
      },
      calculations: {
        monthly: -1, // unlimited
        scenarioComparison: true,
        advancedBreakdown: true,
      },
      api: {
        requestsPerMonth: -1, // unlimited
        rateLimit: { perMinute: 300, perDay: -1 },
        webhooks: true,
      },
      widget: {
        enabled: true,
        calculationsPerMonth: -1, // unlimited
        customBranding: true,
        analyticsEnabled: true,
      },
      data: {
        dataRetentionDays: -1, // forever
        exportFormats: ['csv', 'excel', 'pdf', 'json'],
        auditPacks: true,
      },
      support: {
        level: 'dedicated',
        responseTimeSLA: '4 hours',
      },
      team: {
        maxUsers: -1, // unlimited
        roleBasedAccess: true,
        auditLogs: true,
      },
    },
  },
};

// Overage rates (per unit over quota)
export const OVERAGE_RATES: Record<string, number> = {
  'classifications.monthly': 0.50, // $0.50 per classification
  'calculations.monthly': 0.10,    // $0.10 per calculation
  'widget.calculationsPerMonth': 0.15, // $0.15 per widget calculation
  'api.requestsPerMonth': 0.001,  // $0.001 per API request
};

// Helper function to get plan by ID
export function getPlanById(planId: string): Plan | undefined {
  return PLANS[planId];
}

// Helper function to get all plans
export function getAllPlans(): Plan[] {
  return Object.values(PLANS);
}

// Helper function to get plan tier level (for comparison)
export function getPlanTier(planId: string): number {
  const tiers: Record<string, number> = {
    FREE: 0,
    STARTER: 1,
    PROFESSIONAL: 2,
    ENTERPRISE: 3,
  };
  return tiers[planId] ?? 0;
}
