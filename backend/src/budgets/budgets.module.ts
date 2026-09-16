import { Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BudgetHistoryService } from './budget-history.service';

@Module({
  imports: [PrismaModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetHistoryService],
  exports: [BudgetsService, BudgetHistoryService],
})
export class BudgetsModule {}
