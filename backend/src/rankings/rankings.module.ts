import { Controller, Get, Module, Query } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaModule } from '../prisma/prisma.module';
import { SocialModule } from '../social/social.module';
import { RankingPeriodsQuery, RankingQuery } from './rankings.dto';
import { RankingsService } from './rankings.service';

@Controller('rankings')
class RankingsController {
  constructor(private readonly service: RankingsService) {}
  @Get('periods') async periods(@CurrentUser('id') id: string, @Query() query: RankingPeriodsQuery) {
    return { success: true, data: await this.service.periods(id, query) };
  }
  @Get() async list(@CurrentUser('id') id: string, @Query() query: RankingQuery) {
    return { success: true, data: await this.service.list(id, query) };
  }
}
@Module({ imports: [PrismaModule, AuthModule, SocialModule], controllers: [RankingsController], providers: [RankingsService], exports: [RankingsService] })
export class RankingsModule {}
