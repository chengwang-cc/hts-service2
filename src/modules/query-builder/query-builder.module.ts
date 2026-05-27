import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { KnowledgebaseCardsModule } from '../knowledgebase-cards/knowledgebase-cards.module';
import { QueryBuilderController } from './controllers/query-builder.controller';
import { QueryBuilderTemplateEntity } from './entities/query-builder-template.entity';
import { QueryBuilderService } from './services/query-builder.service';
import { QueryBuilderSynthesizerService } from './services/query-builder-synthesizer.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([QueryBuilderTemplateEntity]),
    AuthModule,
    KnowledgebaseCardsModule,
  ],
  controllers: [QueryBuilderController],
  providers: [QueryBuilderService, QueryBuilderSynthesizerService],
  exports: [QueryBuilderService],
})
export class QueryBuilderModule {}
