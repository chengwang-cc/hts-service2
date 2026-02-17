import axios from 'axios';

type ValidationTarget = {
  provider: string;
  htsNumber: string;
  countryCode: string;
  entryDate: string;
  modeOfTransport?: string;
  value?: number;
  productName?: string;
  inputContext?: Record<string, any>;
  useMock?: boolean;
  useAiExtraction?: boolean;
};

const BASE_URL = process.env.HTS_BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.HTS_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.HTS_ADMIN_PASSWORD || '';
const VALIDATE_USE_MOCK = (process.env.EXTERNAL_PROVIDER_VALIDATE_USE_MOCK || 'false') === 'true';
const ANALYZE_MISMATCH = (process.env.EXTERNAL_PROVIDER_ANALYZE_MISMATCH || 'true') === 'true';
const REQUIRE_PROVIDER_FORMULA =
  (process.env.EXTERNAL_PROVIDER_REQUIRE_FORMULA || 'true') === 'true';
const AUTO_ANALYZE_ON_MISMATCH =
  (process.env.EXTERNAL_PROVIDER_AUTO_ANALYZE_MISMATCH || 'true') === 'true';
const USE_AI_EXTRACTION = (process.env.EXTERNAL_PROVIDER_USE_AI_EXTRACTION || 'true') === 'true';
const TARGETS_JSON = process.env.EXTERNAL_PROVIDER_TARGETS_JSON;

const log = (message: string) => {
  process.stdout.write(`[external-provider-validate] ${message}\n`);
};

function loadTargets(): ValidationTarget[] {
  if (TARGETS_JSON && TARGETS_JSON.trim()) {
    const parsed = JSON.parse(TARGETS_JSON);
    if (!Array.isArray(parsed)) {
      throw new Error('EXTERNAL_PROVIDER_TARGETS_JSON must be an array');
    }
    return parsed as ValidationTarget[];
  }

  return [
    {
      provider: 'FLEXPORT',
      htsNumber: '4820.10.20.10',
      countryCode: 'CN',
      entryDate: new Date().toISOString().slice(0, 10),
      modeOfTransport: 'OCEAN',
      value: 10000,
      useMock: VALIDATE_USE_MOCK,
    },
  ];
}

async function login(): Promise<string> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('HTS_ADMIN_EMAIL and HTS_ADMIN_PASSWORD are required');
  }

  const response = await axios.post(`${BASE_URL}/auth/login`, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  const responseBody = response.data || {};
  if (
    typeof responseBody?.statusCode === 'number' &&
    responseBody.statusCode >= 400
  ) {
    throw new Error(
      `Login failed: ${responseBody.message || 'invalid credentials'} (statusCode=${responseBody.statusCode})`,
    );
  }

  const token =
    response.data?.accessToken ||
    response.data?.data?.accessToken ||
    response.data?.tokens?.accessToken ||
    response.data?.data?.tokens?.accessToken;

  if (!token) {
    throw new Error(
      `Login failed: no access token (body keys=${Object.keys(responseBody).join(',')})`,
    );
  }

  return token as string;
}

async function validateTarget(token: string, target: ValidationTarget) {
  const payload = {
    provider: target.provider,
    htsNumber: target.htsNumber,
    countryCode: target.countryCode,
    entryDate: target.entryDate,
    modeOfTransport: target.modeOfTransport || 'OCEAN',
    value: target.value,
    productName: target.productName,
    inputContext: target.inputContext || {},
    useMock: target.useMock ?? VALIDATE_USE_MOCK,
    requireFormulaExtraction: REQUIRE_PROVIDER_FORMULA,
    useAiExtraction: target.useAiExtraction ?? USE_AI_EXTRACTION,
    autoAnalyzeOnMismatch: AUTO_ANALYZE_ON_MISMATCH,
    upsertLatest: true,
  };

  const response = await axios.post(`${BASE_URL}/admin/external-provider-formulas/validate`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return response.data?.data;
}

async function analyzeTarget(token: string, target: ValidationTarget) {
  const response = await axios.post(
    `${BASE_URL}/admin/external-provider-formulas/compare/analyze`,
    {
      provider: target.provider,
      htsNumber: target.htsNumber,
      countryCode: target.countryCode,
      entryDate: target.entryDate,
      modeOfTransport: target.modeOfTransport || 'OCEAN',
    },
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  return response.data?.data;
}

async function main() {
  const token = await login();
  const targets = loadTargets();
  log(`Loaded ${targets.length} validation target(s)`);

  let matches = 0;
  let mismatches = 0;

  for (const target of targets) {
    const context = `${target.provider}:${target.htsNumber}:${target.countryCode}:${target.entryDate}`;
    log(`Validating ${context}`);
    const result = await validateTarget(token, target);
    const comparison = result?.comparison?.comparison;
    const isMatch = comparison?.isMatch === true;
    const extractedFormula =
      result?.snapshot?.formulaNormalized || result?.snapshot?.formulaRaw || null;

    if (REQUIRE_PROVIDER_FORMULA && !extractedFormula) {
      throw new Error(`Provider formula extraction missing for ${context}`);
    }

    if (isMatch) {
      matches += 1;
      log(`MATCH ${context}`);
      continue;
    }

    mismatches += 1;
    log(`MISMATCH ${context} reason=${comparison?.mismatchReason || 'UNKNOWN'}`);

    if (ANALYZE_MISMATCH) {
      const analysis =
        result?.analysis != null ? { analysis: result.analysis } : await analyzeTarget(token, target);
      const summary = analysis?.analysis?.summary || 'No analysis summary';
      if (!analysis?.analysis) {
        throw new Error(`Analysis missing for mismatched context ${context}`);
      }
      log(`ANALYSIS ${context}: ${summary}`);
    }
  }

  log(`Completed. matches=${matches} mismatches=${mismatches} total=${targets.length}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
