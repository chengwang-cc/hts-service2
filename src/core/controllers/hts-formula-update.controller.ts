import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { HtsFormulaUpdateService } from '../services/hts-formula-update.service';
import {
  HtsFormulaUpdateDto,
  SearchFormulaUpdateDto,
} from '../dto/hts-formula-update.dto';

@Controller('hts-formula-updates')
export class HtsFormulaUpdateController {
  constructor(private readonly formulaUpdateService: HtsFormulaUpdateService) {}

  @Post()
  async upsert(@Body() dto: HtsFormulaUpdateDto) {
    const result = await this.formulaUpdateService.upsert(dto);
    return { success: true, data: result };
  }

  @Get('search')
  async search(@Query() query: SearchFormulaUpdateDto) {
    const result = await this.formulaUpdateService.search(query);
    return {
      success: true,
      ...result,
    };
  }
}
