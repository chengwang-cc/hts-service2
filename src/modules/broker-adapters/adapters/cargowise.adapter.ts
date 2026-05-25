import { Injectable, Logger } from '@nestjs/common';
import {
  AdapterArtifact,
  AdapterContext,
  AdapterDeliveryResult,
  BrokerExportAdapter,
} from './adapter.contract';

/**
 * R2-C-03 — WiseTech CargoWise eAdaptor adapter.
 *
 * UNTESTED AGAINST PRODUCTION VENDOR SANDBOX.
 *
 * CargoWise eAdaptor uses an XML envelope (UniversalShipment XML) posted to
 * `https://services.cargowise.com/eAdaptor` with HTTP Basic auth derived
 * from a CargoWise eAdaptor user + GUID password. Real production deploys
 * almost always need the WiseTech-provided XSD validator running ahead of
 * delivery; this adapter does not include schema validation — that lands
 * once we have a verified sample envelope from the customer's CargoWise
 * tenant.
 *
 * Required secrets:
 *   - cargowiseUsername: eAdaptor username (typically "ABCXYZ-EBL").
 *   - cargowisePassword: GUID password.
 *
 * Required publicConfig:
 *   - url: eAdaptor endpoint (default https://services.cargowise.com/eAdaptor).
 *   - clientCode: 3-letter CargoWise client code embedded in the envelope.
 */
@Injectable()
export class CargoWiseAdapter implements BrokerExportAdapter {
  readonly key = 'cargowise' as const;
  private readonly logger = new Logger(CargoWiseAdapter.name);

  async build(ctx: AdapterContext): Promise<AdapterArtifact> {
    const clientCode = String(
      (ctx.adapter.publicConfig as Record<string, unknown> | null)?.clientCode ?? 'HTS',
    );
    const xml = buildUniversalShipmentXml(ctx, clientCode);
    return {
      contentType: 'application/xml',
      fileName: `cargowise-${ctx.entry.entryNumber || ctx.entry.id}.xml`,
      body: Buffer.from(xml, 'utf-8'),
    };
  }

  async deliver(
    ctx: AdapterContext,
    artifact: AdapterArtifact,
  ): Promise<AdapterDeliveryResult> {
    const config = ctx.adapter.publicConfig ?? {};
    const url =
      (typeof config.url === 'string' && config.url) ||
      'https://services.cargowise.com/eAdaptor';
    const secrets = ctx.decryptedSecrets ?? {};
    if (!secrets.cargowiseUsername || !secrets.cargowisePassword) {
      return {
        delivered: false,
        error:
          'CargoWise adapter requires secrets.cargowiseUsername + secrets.cargowisePassword',
      };
    }

    const timeoutMs = clampInt(config.timeoutMs as number | undefined, 1000, 60000, 20000);
    const retryLimit = clampInt(config.retryLimit as number | undefined, 0, 5, 2);
    const basic = Buffer.from(
      `${secrets.cargowiseUsername}:${secrets.cargowisePassword}`,
    ).toString('base64');
    const headers: Record<string, string> = {
      'content-type': 'application/xml',
      authorization: `Basic ${basic}`,
      'soapaction': '""', // eAdaptor accepts an empty SOAPAction header
    };

    let lastError: string | undefined;
    let lastResponseSummary: AdapterDeliveryResult['responseSummary'];
    const attempts = retryLimit + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: new Uint8Array(artifact.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const responseText = await response.text().catch(() => '');
        lastResponseSummary = {
          status: response.status,
          ok: response.ok,
          bodyPreview: responseText.slice(0, 500),
          providerReference: extractCargoWiseRef(responseText),
        };
        // eAdaptor returns 200 even on Fault payloads — we have to inspect
        // the body for a SOAP fault before declaring success.
        const soapFault = /<faultstring>([\s\S]*?)<\/faultstring>/i.exec(responseText);
        if (response.ok && !soapFault) {
          return {
            delivered: true,
            requestSummary: { url, attempt, byteSize: artifact.body.byteLength, provider: 'cargowise' },
            responseSummary: lastResponseSummary,
          };
        }
        lastError = soapFault
          ? `CargoWise fault: ${soapFault[1].slice(0, 200)}`
          : `CargoWise responded ${response.status}`;
        if (!isRetryable(response.status) || soapFault || attempt === attempts) {
          break;
        }
      } catch (err) {
        lastError =
          err instanceof Error ? `${err.name}: ${err.message}` : 'CargoWise delivery failed';
        if (attempt === attempts) break;
      }
      if (attempt < attempts) {
        await sleep(500 * attempt);
        this.logger.warn(`CargoWise delivery retry ${attempt}/${retryLimit}: ${lastError}`);
      }
    }

    return {
      delivered: false,
      requestSummary: { url, attempt: attempts },
      responseSummary: lastResponseSummary,
      error: lastError ?? 'CargoWise delivery failed',
    };
  }

  requiredFields(): string[] {
    return [
      'entry.id',
      'entry.entryNumber',
      'line.lineNumber',
      'line.htsNumber',
      'line.countryOfOrigin',
      'line.totalValue',
    ];
  }
}

/**
 * Minimal UniversalShipment XML — wraps the entry header + lines in the
 * shape WiseTech's eAdaptor accepts. Real customer envelopes carry many
 * more elements (LRN, address parties, packing lines, customs branches).
 * This skeleton lets the adapter round-trip but the receiving CargoWise
 * tenant will need the additional fields populated via the field mapping
 * profile before going live.
 */
function buildUniversalShipmentXml(
  ctx: AdapterContext,
  clientCode: string,
): string {
  const safe = (s: any) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
  const lineXml = ctx.lines
    .map(
      (line) => `
      <SubLineCollection>
        <SubLine>
          <LineNumber>${safe(line.lineNumber)}</LineNumber>
          <Description>${safe(line.description)}</Description>
          <CommodityCode>${safe(line.htsNumber)}</CommodityCode>
          <OriginCountryCode>${safe(line.countryOfOrigin)}</OriginCountryCode>
          <Quantity>${safe(line.quantity)}</Quantity>
          <UnitPrice>${safe(line.unitValue)}</UnitPrice>
          <LineTotal>${safe(line.totalValue)}</LineTotal>
          <Currency>${safe(line.currency)}</Currency>
        </SubLine>
      </SubLineCollection>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<UniversalShipment xmlns="http://www.cargowise.com/Schemas/Universal/2011/11">
  <Shipment>
    <DataContext>
      <Company>
        <Code>${safe(clientCode)}</Code>
      </Company>
    </DataContext>
    <ContainerCount>0</ContainerCount>
    <CustomsImportEntry>
      <EntryNumber>${safe(ctx.entry.entryNumber)}</EntryNumber>
      <EntryType>${safe(ctx.entry.entryType)}</EntryType>
      <CurrencyCode>${safe(ctx.entry.currency)}</CurrencyCode>
      <TotalCustomsValue>${safe(ctx.entry.totalValue)}</TotalCustomsValue>
      <ApprovedOn>${safe(ctx.entry.approvedAt?.toISOString())}</ApprovedOn>${lineXml}
    </CustomsImportEntry>
  </Shipment>
</UniversalShipment>`;
}

function extractCargoWiseRef(body: string): string | undefined {
  const match = /<ContextID>([^<]+)<\/ContextID>/i.exec(body);
  return match?.[1];
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

function clampInt(
  v: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
