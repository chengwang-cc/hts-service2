#!/usr/bin/env ts-node

import { FormulaAiValidationHealthService } from '../src/modules/admin/services/formula-ai-validation-health.service';

async function main() {
  const service = new FormulaAiValidationHealthService();
  const report = await service.checkAll();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});

