import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JurisdictionEntity } from '../entities/jurisdiction.entity';

export class UnsupportedJurisdictionError extends Error {
  readonly code = 'UNSUPPORTED_JURISDICTION';
  constructor(jurisdictionCode: string) {
    super(`No adapter for jurisdiction ${jurisdictionCode}`);
  }
}

export class EuMemberStateRequiredError extends Error {
  readonly code = 'EU_REQUIRES_MEMBER_STATE';
  constructor() {
    super(
      'EU destination requires destination.memberState (e.g. DE, FR, NL, IE)',
    );
  }
}

@Injectable()
export class JurisdictionService {
  constructor(
    @InjectRepository(JurisdictionEntity)
    private readonly repo: Repository<JurisdictionEntity>,
  ) {}

  async findByCode(code: string): Promise<JurisdictionEntity | null> {
    if (!code) return null;
    return this.repo.findOne({ where: { code: code.toUpperCase() } });
  }

  async requireByCode(code: string): Promise<JurisdictionEntity> {
    const j = await this.findByCode(code);
    if (!j) {
      throw new NotFoundException(`Jurisdiction ${code} not found`);
    }
    return j;
  }

  async listChildren(parentCode: string): Promise<JurisdictionEntity[]> {
    return this.repo.find({
      where: { parentCode: parentCode.toUpperCase(), isActive: true },
    });
  }

  async listActive(): Promise<JurisdictionEntity[]> {
    return this.repo.find({ where: { isActive: true } });
  }

  /**
   * Resolves a destination input into the actual jurisdiction row that
   * landed-cost should calculate against. If the input is EU but no
   * member state is given, throws EuMemberStateRequiredError.
   */
  async resolveDestination(input: {
    country: string;
    memberState?: string;
  }): Promise<JurisdictionEntity> {
    const country = (input.country || '').toUpperCase();
    if (!country) {
      throw new UnsupportedJurisdictionError('');
    }

    if (country === 'EU') {
      if (!input.memberState) {
        throw new EuMemberStateRequiredError();
      }
      const member = await this.findByCode(input.memberState);
      if (!member || member.parentCode !== 'EU') {
        throw new UnsupportedJurisdictionError(input.memberState);
      }
      return member;
    }

    const j = await this.findByCode(country);
    if (!j) {
      throw new UnsupportedJurisdictionError(country);
    }
    return j;
  }
}
