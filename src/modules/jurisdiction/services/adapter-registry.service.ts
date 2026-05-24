import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  TARIFF_ADAPTERS,
  TariffJurisdictionAdapter,
  DestinationContext,
} from '../interfaces/tariff-jurisdiction-adapter.interface';
import { UnsupportedJurisdictionError } from './jurisdiction.service';

@Injectable()
export class AdapterRegistry {
  private byCode = new Map<string, TariffJurisdictionAdapter>();

  constructor(
    @Optional()
    @Inject(TARIFF_ADAPTERS)
    adapters: TariffJurisdictionAdapter[] = [],
  ) {
    for (const a of adapters || []) {
      this.byCode.set(a.jurisdictionCode.toUpperCase(), a);
    }
  }

  register(adapter: TariffJurisdictionAdapter): void {
    this.byCode.set(adapter.jurisdictionCode.toUpperCase(), adapter);
  }

  has(code: string): boolean {
    return this.byCode.has((code || '').toUpperCase());
  }

  get(code: string): TariffJurisdictionAdapter {
    const adapter = this.byCode.get((code || '').toUpperCase());
    if (!adapter) {
      throw new UnsupportedJurisdictionError(code);
    }
    return adapter;
  }

  pickForDestination(destination: DestinationContext): TariffJurisdictionAdapter {
    const code = (destination.country || '').toUpperCase();
    const adapter = this.byCode.get(code);
    if (adapter && adapter.supports(destination)) {
      return adapter;
    }
    // Fallback: iterate registered adapters and let each `supports()`
    // claim. Used e.g. for EU member states (country='DE') that should
    // route to the EU adapter even though it's registered under 'EU'.
    for (const candidate of this.byCode.values()) {
      if (candidate.supports(destination)) {
        return candidate;
      }
    }
    throw new UnsupportedJurisdictionError(code);
  }

  listCodes(): string[] {
    return Array.from(this.byCode.keys());
  }
}
