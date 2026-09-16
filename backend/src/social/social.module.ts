import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaModule } from '../prisma/prisma.module';
import { SocialAccessService } from './social-access.service';
import { ApproveRequestDto, EnableSocialDto, RequestVersionDto, ReviewableBillsQuery, SaveGrantDto, SearchSocialDto, SocialPageDto, SocialPreferencesDto, SubmitRequestDto } from './social.dto';
import { SocialService } from './social.service';
import { ReviewRequestService } from './review-request.service';

const normalizeId = { transform: (id: string) => id.toLowerCase() };

@Controller('social')
class SocialController {
  constructor(private readonly service: SocialService, private readonly requests: ReviewRequestService) {}
  private respond<T>(result: Promise<T>) { return result.then(data => ({ success: true, data })); }
  @Delete('enable') disable(@CurrentUser('id') id: string) { return this.respond(this.service.disable(id)); }
  @Get('me') me(@CurrentUser('id') id: string) { return this.respond(this.service.preferences(id)); }
  @Get('reviewable-owners') reviewableOwners(@CurrentUser('id') id: string, @Query() dto: SocialPageDto) { return this.respond(this.service.reviewableOwners(id, dto)); }
  @Get('requests/:direction') requestsList(@CurrentUser('id') id: string, @Param('direction') direction: string, @Query() dto: SocialPageDto) { return this.respond(this.requests.list(id, direction, dto)); }
  @Get('requests/to/:id') requestContext(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string) { return this.respond(this.requests.context(id, target)); }
  @Post('requests/to/:id') request(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string, @Body() dto: SubmitRequestDto) { return this.respond(this.requests.submit(id, target, dto)); }
  @Post('requests/to/:id/withdraw') withdraw(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string, @Body() dto: RequestVersionDto) { return this.respond(this.requests.withdraw(id, target, dto)); }
  @Post('requests/from/:id/approve') approve(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string, @Body() dto: ApproveRequestDto) { return this.respond(this.requests.approve(id, target, dto)); }
  @Post('requests/from/:id/reject') reject(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string, @Body() dto: RequestVersionDto) { return this.respond(this.requests.reject(id, target, dto)); }
  @Post('enable') enable(@CurrentUser('id') id: string, @Body() dto: EnableSocialDto) { return this.respond(this.service.enable(id, dto)); }
  @Patch('preferences') preferences(@CurrentUser('id') id: string, @Body() dto: SocialPreferencesDto) { return this.respond(this.service.updatePreferences(id, dto)); }
  @Get('users') search(@CurrentUser('id') id: string, @Query() dto: SearchSocialDto) { return this.respond(this.service.search(id, dto)); }
  @Get('users/:id') profile(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string) { return this.respond(this.service.profile(id, target)); }
  @Get('users/:id/relations/:kind') relations(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string, @Param('kind') kind: string, @Query() dto: SocialPageDto) { return this.respond(this.service.relations(id, target, kind, dto)); }
  @Put('following/:id') follow(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string) { return this.respond(this.service.follow(id, target, true)); }
  @Delete('following/:id') unfollow(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string) { return this.respond(this.service.follow(id, target, false)); }
  @Get('blocks') blocks(@CurrentUser('id') id: string, @Query() dto: SocialPageDto) { return this.respond(this.service.blocks(id, dto)); }
  @Put('blocks/:id') block(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string) { return this.respond(this.service.block(id, target, true)); }
  @Delete('blocks/:id') unblock(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string) { return this.respond(this.service.block(id, target, false)); }
  @Get('grants/:direction') grants(@CurrentUser('id') id: string, @Param('direction') direction: string, @Query() dto: SocialPageDto) { return this.respond(this.service.grants(id, direction, dto)); }
  @Get('grants/with/:id') grantsWith(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string) { return this.respond(this.service.grantsWith(id, target)); }
  @Put('grants/given/:id') grant(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string, @Body() dto: SaveGrantDto) { return this.respond(this.service.saveGrant(id, target, dto)); }
  @Delete('grants/given/:id') revoke(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string) { return this.respond(this.service.endGrant(id, target, false)); }
  @Delete('grants/received/:id') exit(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string) { return this.respond(this.service.endGrant(id, target, true)); }
  @Get('owners/:id/bills') bills(@CurrentUser('id') id: string, @Param('id', ParseUUIDPipe, normalizeId) target: string, @Query() dto: ReviewableBillsQuery) { return this.respond(this.service.reviewableBills(id, target, dto)); }
}

@Module({ imports: [PrismaModule, AuthModule], controllers: [SocialController], providers: [SocialService, SocialAccessService, ReviewRequestService], exports: [SocialService, SocialAccessService] })
export class SocialModule {}
