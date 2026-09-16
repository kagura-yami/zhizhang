import { Body, Controller, Get, Module, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaModule } from '../prisma/prisma.module';
import { SocialModule } from '../social/social.module';
import { ChangeReviewMessageDto, NewReviewMessageDto, ReviewPageDto, VoteDto } from './reviews.dto';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
class ReviewsController {
  constructor(private readonly service: ReviewsService) {}
  private result<T>(promise: Promise<T>) { return promise.then(data => ({ success: true, data })); }
  @Put('bills/:id/vote') vote(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number, @Body() dto: VoteDto) { return this.result(this.service.vote(user, id, dto.vote)); }
  @Get('bills/:id/mine') myVote(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number) { return this.result(this.service.myVote(user, id)); }
  @Get('bills/:id/summary') summary(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number, @Query() q: ReviewPageDto) { return this.result(this.service.ownerSummary(user, id, q)); }
  @Get('mine') mine(@CurrentUser('id') user: string, @Query() q: ReviewPageDto) { return this.result(this.service.mine(user, q)); }
  @Get('threads/:id') detail(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number, @Query() q: ReviewPageDto) { return this.result(this.service.detail(user, id, q)); }
  @Post('threads/:id/main') main(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number, @Body() dto: NewReviewMessageDto) { return this.result(this.service.createMessage(user, id, dto, true)); }
  @Post('threads/:id/replies') reply(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number, @Body() dto: NewReviewMessageDto) { return this.result(this.service.createMessage(user, id, dto, false)); }
  @Patch('threads/:id/messages/:messageId') change(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number, @Param('messageId', ParseIntPipe) message: number, @Body() dto: ChangeReviewMessageDto) { return this.result(this.service.changeMessage(user, id, message, dto)); }
  @Get('threads/:id/messages/:messageId/versions') versions(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number, @Param('messageId', ParseIntPipe) message: number, @Query() q: ReviewPageDto) { return this.result(this.service.versions(user, id, message, q)); }
}
@Module({ imports: [PrismaModule, AuthModule, SocialModule], controllers: [ReviewsController], providers: [ReviewsService], exports: [ReviewsService] })
export class ReviewsModule {}
