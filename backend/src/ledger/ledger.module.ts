import { Body, Controller, Get, Module, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaModule } from '../prisma/prisma.module';
import { ClassifyBillDto, LedgerSummaryQueryDto } from './ledger.dto';
import { LedgerService } from './ledger.service';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('summary')
  async summary(@CurrentUser('id') userId: string, @Query() query: LedgerSummaryQueryDto) {
    return { success: true, data: await this.ledger.summary(userId, query) };
  }

  @Put('bills/:id/classification')
  async classify(@CurrentUser('id') userId: string, @Param('id', ParseIntPipe) id: number, @Body() dto: ClassifyBillDto) {
    return { success: true, data: await this.ledger.classify(userId, id, dto) };
  }
}

@Module({ imports: [PrismaModule, AuthModule], controllers: [LedgerController], providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
