import { Body, Controller, Get, Module, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAccessGuard } from '../admin/admin-access.guard';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaModule } from '../prisma/prisma.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { SocialPageDto } from '../social/social.dto';
import { SocialModule } from '../social/social.module';
import { CreateReviewReportDto, DecideReviewReportDto, ModerationQueryDto } from './moderation.dto';
import { ModerationService } from './moderation.service';

@Controller('review-reports')
class ReviewReportsController {
  constructor(private readonly service: ModerationService) {}
  @Get('threads/:threadId/messages/:messageId')
  async preview(@CurrentUser('id') user: string, @Param('threadId', ParseIntPipe) thread: number, @Param('messageId', ParseIntPipe) message: number) {
    return { success: true, data: await this.service.preview(user, thread, message) };
  }
  @Post('threads/:threadId/messages/:messageId')
  async report(@CurrentUser('id') user: string, @Param('threadId', ParseIntPipe) thread: number, @Param('messageId', ParseIntPipe) message: number, @Body() dto: CreateReviewReportDto) {
    return { success: true, data: await this.service.report(user, thread, message, dto) };
  }
  @Get() async mine(@CurrentUser('id') user: string, @Query() dto: SocialPageDto) { return { success: true, data: await this.service.mine(user, dto) }; }
}

@Public()
@UseGuards(AdminAccessGuard)
@Controller('admin-api/moderation')
class ModerationController {
  constructor(private readonly service: ModerationService) {}
  @Get() async list(@Query() q: ModerationQueryDto) { return { success: true, data: await this.service.list(q) }; }
  @Get(':id/evidence') async evidence(@Param('id', ParseIntPipe) id: number, @Req() req: { admin?: { username?: string } }, @Query() q: SocialPageDto) {
    return { success: true, data: await this.service.evidence(id, (req.admin?.username || 'admin').slice(0, 100), q) };
  }
  @Post(':id/decision') async decision(@Param('id', ParseIntPipe) id: number, @Req() req: { admin?: { username?: string } }, @Body() dto: DecideReviewReportDto) {
    return { success: true, data: await this.service.decide(id, (req.admin?.username || 'admin').slice(0, 100), dto) };
  }
}
@Module({ imports: [PrismaModule, AuthModule, AdminModule, ReviewsModule, SocialModule], controllers: [ReviewReportsController, ModerationController], providers: [ModerationService] })
export class ModerationModule {}
