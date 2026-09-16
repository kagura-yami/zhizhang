import { Module } from '@nestjs/common';
import { AIController } from './ai.controller';
import { AIConfigController } from './ai-config.controller';
import { ChatController } from './chat.controller';
import { AsrController } from './asr.controller';
import { AIService } from './ai.service';
import { AIConfigService } from './ai-config.service';
import { ChatService } from './services/chat.service';
import { SessionService } from './services/session.service';
import { ToolExecutorService } from './services/tool-executor.service';
import { AsrService } from './services/asr.service';
import {
  ClaudeAdapter,
  OpenAIAdapter,
  DeepSeekAdapter,
  QwenAdapter,
} from './adapters';
import { BillsModule } from '../bills/bills.module';
import { CategoriesModule } from '../categories/categories.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { RetrospectiveEvidenceService } from './services/retrospective-evidence.service';
import { RetrospectiveGeneratorService } from './services/retrospective-generator.service';
import { RetrospectiveJobsService } from './services/retrospective-jobs.service';
import { RetrospectiveController } from './retrospective.controller';

@Module({
  imports: [BillsModule, CategoriesModule, BudgetsModule],
  controllers: [AIController, AIConfigController, ChatController, AsrController, RetrospectiveController],
  providers: [
    RetrospectiveEvidenceService,
    RetrospectiveGeneratorService,
    RetrospectiveJobsService,
    AIService,
    AIConfigService,
    ChatService,
    SessionService,
    ToolExecutorService,
    AsrService,
    ClaudeAdapter,
    OpenAIAdapter,
    DeepSeekAdapter,
    QwenAdapter,
  ],
  exports: [AIService, AIConfigService],
})
export class AIModule {}
