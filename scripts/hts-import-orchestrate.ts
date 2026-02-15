import axios from 'axios';

type ImportStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'STAGED_READY'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK'
  | 'REQUIRES_REVIEW'
  | 'REJECTED';

const BASE_URL = process.env.HTS_BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.HTS_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.HTS_ADMIN_PASSWORD || '';
const IMPORT_VERSION = process.env.HTS_IMPORT_VERSION || 'latest';
const IMPORT_YEAR = process.env.HTS_IMPORT_YEAR;
const IMPORT_REVISION = process.env.HTS_IMPORT_REVISION;
const AUTO_APPROVE = (process.env.HTS_AUTO_APPROVE || 'false') === 'true';
const AUTO_APPROVE_WITH_OVERRIDE =
  (process.env.HTS_AUTO_APPROVE_WITH_OVERRIDE || 'false') === 'true';
const AUTO_REJECT = (process.env.HTS_AUTO_REJECT || 'true') === 'true';
const ENFORCE_FORMULA_GATE = (process.env.HTS_ENFORCE_FORMULA_GATE || 'true') === 'true';
const VALIDATION_SEVERITY = process.env.HTS_VALIDATION_SEVERITY || 'ERROR';
const POLL_INTERVAL_MS = parseInt(process.env.HTS_POLL_INTERVAL_MS || '5000', 10);
const MAX_WAIT_MS = parseInt(process.env.HTS_MAX_WAIT_MS || '1800000', 10);

const log = (message: string) => {
  process.stdout.write(`[hts-orchestrate] ${message}\n`);
};

async function login(): Promise<string> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('HTS_ADMIN_EMAIL and HTS_ADMIN_PASSWORD are required');
  }

  const response = await axios.post(`${BASE_URL}/auth/login`, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });

  const token =
    response.data?.accessToken ||
    response.data?.data?.accessToken ||
    response.data?.tokens?.accessToken ||
    response.data?.data?.tokens?.accessToken;

  if (!token) {
    throw new Error('Login failed: no access token');
  }

  return token as string;
}

async function triggerImport(token: string): Promise<string> {
  const payload: Record<string, any> = {};

  if (IMPORT_VERSION && IMPORT_VERSION !== 'latest') {
    payload.version = IMPORT_VERSION;
  } else {
    payload.version = 'latest';
  }

  if (IMPORT_YEAR) payload.year = parseInt(IMPORT_YEAR, 10);
  if (IMPORT_REVISION) payload.revision = parseInt(IMPORT_REVISION, 10);

  const response = await axios.post(`${BASE_URL}/admin/hts-imports`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return response.data?.data?.id as string;
}

async function getImport(token: string, importId: string) {
  const response = await axios.get(`${BASE_URL}/admin/hts-imports/${importId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data?.data;
}

async function getSummary(token: string, importId: string) {
  const response = await axios.get(`${BASE_URL}/admin/hts-imports/${importId}/stage/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data?.data;
}

async function getValidation(token: string, importId: string) {
  const response = await axios.get(`${BASE_URL}/admin/hts-imports/${importId}/stage/validation`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { severity: VALIDATION_SEVERITY, limit: 1000 },
  });
  return response.data?.data || [];
}

async function getFormulaGate(token: string, importId: string) {
  const response = await axios.get(
    `${BASE_URL}/admin/hts-imports/${importId}/stage/formula-gate`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return response.data?.data || null;
}

async function promote(token: string, importId: string) {
  return axios.post(`${BASE_URL}/admin/hts-imports/${importId}/promote`, {}, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function reject(token: string, importId: string, reason?: string) {
  return axios.post(`${BASE_URL}/admin/hts-imports/${importId}/reject`, { reason }, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function pollUntilStable(token: string, importId: string): Promise<ImportStatus> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const current = await getImport(token, importId);
    const status = current?.status as ImportStatus;
    log(`status=${status}`);

    if (
      status === 'COMPLETED' ||
      status === 'FAILED' ||
      status === 'REQUIRES_REVIEW' ||
      status === 'STAGED_READY' ||
      status === 'REJECTED'
    ) {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for import ${importId}`);
}

async function promoteAndWait(token: string, importId: string): Promise<ImportStatus> {
  await promote(token, importId);
  log('Promotion requested; waiting for completion.');
  const status = await pollUntilStable(token, importId);
  log(`Post-promotion status: ${status}`);
  return status;
}

async function main() {
  const token = await login();
  log('Logged in');

  const importId = await triggerImport(token);
  log(`Triggered import: ${importId}`);

  const status = await pollUntilStable(token, importId);
  log(`Final import status: ${status}`);

  if (status === 'FAILED') {
    throw new Error(`Import failed: ${importId}`);
  }

  if (status === 'REJECTED') {
    log(`Import already rejected: ${importId}`);
    return;
  }

  if (status === 'STAGED_READY' || status === 'REQUIRES_REVIEW') {
    const summary = await getSummary(token, importId);
    log(`Summary: staged=${summary?.stagedCount} errors=${summary?.validationCounts?.ERROR || 0}`);

    const issues = await getValidation(token, importId);
    log(`Validation issues (${VALIDATION_SEVERITY}): ${issues.length}`);

    const formulaGate = await getFormulaGate(token, importId);
    const formulaGatePassed = formulaGate?.formulaGatePassed !== false;
    const coverage =
      typeof formulaGate?.formulaCoverage === 'number'
        ? `${(formulaGate.formulaCoverage * 100).toFixed(2)}%`
        : 'n/a';
    log(`Formula gate: passed=${formulaGatePassed} coverage=${coverage}`);

    const formulaGateBlocking = ENFORCE_FORMULA_GATE && !formulaGatePassed;

    if (issues.length === 0 && !formulaGateBlocking && AUTO_APPROVE) {
      const finalStatus = await promoteAndWait(token, importId);
      if (finalStatus === 'FAILED') {
        throw new Error(`Promotion failed: ${importId}`);
      }
      if (finalStatus === 'COMPLETED') {
        log('Import completed successfully after promotion.');
      }
      return;
    }

    if ((issues.length > 0 || formulaGateBlocking) && AUTO_APPROVE_WITH_OVERRIDE) {
      const finalStatus = await promoteAndWait(token, importId);
      if (finalStatus === 'FAILED') {
        throw new Error(`Promotion failed after override: ${importId}`);
      }
      if (finalStatus === 'COMPLETED') {
        log('Import completed successfully with override promotion.');
      }
      return;
    }

    if ((issues.length > 0 || formulaGateBlocking) && AUTO_REJECT) {
      const reasons: string[] = [];
      if (issues.length > 0) reasons.push(`${issues.length} validation issues`);
      if (formulaGateBlocking) reasons.push('formula gate failed');
      await reject(token, importId, reasons.join('; '));
      log('Import rejected due to validation errors.');
      return;
    }

    log('No auto action taken. Review required.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
