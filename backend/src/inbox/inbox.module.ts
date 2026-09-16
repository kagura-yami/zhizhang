import { Body, Controller, Get, Module, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaModule } from '../prisma/prisma.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { SocialModule } from '../social/social.module';
import { InboxQueryDto, ReadInboxDto } from './inbox.dto';
import { InboxService } from './inbox.service';

@Controller('social/inbox')
class InboxController {
  constructor(private readonly service: InboxService) {}
  @Get() async list(@CurrentUser('id') user: string, @Query() query: InboxQueryDto) {
    return { success: true, data: await this.service.list(user, query) };
  }
  @Get('threads/:id') async feedback(@CurrentUser('id') user: string, @Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.service.feedback(user, id) };
  }
  @Post('read') async read(@CurrentUser('id') user: string, @Body() body: ReadInboxDto) {
    return { success: true, data: await this.service.read(user, body.receipt) };
  }
}
@Module({ imports: [PrismaModule, AuthModule, SocialModule, ReviewsModule], controllers: [InboxController], providers: [InboxService] })
export class InboxModule {}
