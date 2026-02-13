import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { CountryService } from '@hts/i18n';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('i18n')
export class I18nController {
  constructor(private readonly countryService: CountryService) {}

  /**
   * List all supported countries
   */
  @Get('countries')
  async listCountries() {
    return this.countryService.getSupportedCountries();
  }

  /**
   * Get country configuration
   */
  @Get('countries/:countryCode')
  async getCountryConfig(@Param('countryCode') countryCode: string) {
    const config = await this.countryService.getCountryConfig(countryCode);

    if (!config) {
      throw new HttpException('Country not found', HttpStatus.NOT_FOUND);
    }

    return config;
  }

  /**
   * Get trade agreements for a country
   */
  @Get('countries/:countryCode/agreements')
  async getTradeAgreements(@Param('countryCode') countryCode: string) {
    return this.countryService.getTradeAgreements(countryCode);
  }

  /**
   * Get tax configuration for a country
   */
  @Get('countries/:countryCode/tax-config')
  async getTaxConfig(@Param('countryCode') countryCode: string) {
    return this.countryService.getTaxConfig(countryCode);
  }

  /**
   * Initialize built-in countries (admin only)
   */
  @Post('countries/initialize')
  @UseGuards(JwtAuthGuard)
  async initializeCountries() {
    await this.countryService.initializeBuiltInCountries();
    return { success: true, message: 'Countries initialized' };
  }
}
