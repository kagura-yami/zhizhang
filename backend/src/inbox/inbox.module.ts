import { Body, Controller, Get, Module, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaModule } from '../prisma/prisma.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { SocialModule } from '../social/social.module';
import { BillFeedbackDto, InboxQueryDto, ReadInboxDto } from './inbox.dto';
import { InboxService } from './inbox.service';
import { NewBillWorker } from './new-bill-worker.service';

@Controller('social/inbox')
class InboxController {
  constructor(private readonly service: InboxService) {}
  @Post('bills/summary') async summaries(@CurrentUser('id') user: string, @Body() body: BillFeedbackDto) {
    return { success: true, data: await this.service.billSummaries(user, body.billIds) };
  }
  @Get('bills/:id') async bill(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.service.billFeedback(user, id) };
  }
  @Get() async list(@CurrentUser('id') user: string, @Query() query: InboxQueryDto) {
    return { success: true, data: await this.service.list(user, query) };
  }
  @Get('events/:id') async event(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.service.event(user, id) };
  }
  @Get('threads/:id') async feedback(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.service.feedback(user, id) };
  }
  @Post('read') async read(@CurrentUser('id') user: string, @Body() body: ReadInboxDto) {
    return { success: true, data: await this.service.read(user, body.receipt) };
  }
}
@Module({ imports: [PrismaModule, AuthModule, SocialModule, ReviewsModule], controllers: [InboxController], providers: [InboxService, NewBillWorker], exports: [InboxService] })
export class InboxModule {}
