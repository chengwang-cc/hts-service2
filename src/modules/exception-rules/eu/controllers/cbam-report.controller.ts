import {
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import {
  CbamQuarterlySettlementService,
  CbamQuarterlyRow,
} from '../cbam-quarterly-settlement.service';

/**
 * CBAM Registry report endpoints (Phase 7, P7.T7).
 *
 *   GET /admin/eu/cbam/quarterly-report?quarter=2026-Q2 (JSON)
 *   GET /admin/eu/cbam/quarterly-report.xml?quarter=2026-Q2 (CBAM Registry XML stub)
 *
 * Phase 7 ships the JSON view + a structural XML stub. The XML format
 * mapped to the CBAM Registry's expected schema is a follow-up — this
 * endpoint emits a stable, parseable shape that the registry-format
 * mapping layer (Phase 7.7-extended) will translate.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/eu/cbam')
export class CbamReportController {
  constructor(private readonly settlement: CbamQuarterlySettlementService) {}

  @Get('quarterly-report')
  @ApiOperation({ summary: 'Get CBAM quarterly aggregate as JSON.' })
  @ApiOkResponse()
  async json(@Query('quarter') quarter?: string): Promise<{
    quarters: CbamQuarterlyRow[];
    disclaimer: string;
  }> {
    return {
      quarters: await this.settlement.summary(quarter),
      disclaimer:
        'CBAM costs shown here are PROVISIONAL aggregates from calculator quotes. The actual financial obligation is settled with the CBAM Registry — these figures do not constitute a payment instruction.',
    };
  }

  @Get('quarterly-report.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @ApiOperation({ summary: 'CBAM Registry XML export (stub format).' })
  @ApiOkResponse()
  async xml(@Query('quarter') quarter?: string): Promise<string> {
    const quarters = await this.settlement.summary(quarter);
    const escapeAttr = (s: string) => s.replace(/"/g, '&quot;');
    const lines: string[] = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<CBAMQuarterlyReport version="0.1" generated="${new Date().toISOString()}">`,
      `  <Disclaimer>Provisional; not a payment instruction.</Disclaimer>`,
    ];
    for (const q of quarters) {
      lines.push(`  <Quarter id="${escapeAttr(q.quarter)}">`);
      lines.push(`    <QuoteCount>${q.quoteCount}</QuoteCount>`);
      lines.push(`    <TotalCBAMCertificates>${q.totalCertificates}</TotalCBAMCertificates>`);
      lines.push(`    <TotalCostEUR>${q.totalCostEur}</TotalCostEUR>`);
      lines.push(`    <Sectors>`);
      for (const [sector, s] of Object.entries(q.sectors)) {
        lines.push(`      <Sector name="${escapeAttr(sector)}">`);
        lines.push(`        <QuoteCount>${s.quoteCount}</QuoteCount>`);
        lines.push(`        <Certificates>${s.certificates}</Certificates>`);
        lines.push(`        <CostEUR>${s.costEur}</CostEUR>`);
        lines.push(`      </Sector>`);
      }
      lines.push(`    </Sectors>`);
      lines.push(`  </Quarter>`);
    }
    lines.push(`</CBAMQuarterlyReport>`);
    return lines.join('\n');
  }
}
