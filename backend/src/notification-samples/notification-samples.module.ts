import { Body, Controller, Get, Module, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { AdminAccessGuard } from '../admin/admin-access.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationSampleQueryDto, UploadNotificationSamplesDto } from './notification-samples.dto';
import { NotificationSamplesService } from './notification-samples.service';

@Controller('notification-samples')
class NotificationSamplesController {
  constructor(private readonly service: NotificationSamplesService) {}
  @Post('batch')
  async upload(@CurrentUser('id') userId: string, @Body() dto: UploadNotificationSamplesDto) {
    return { success: true, data: await this.service.upload(userId, dto) };
  }
}

@Public()
@UseGuards(AdminAccessGuard)
@Controller('admin-api/notification-samples')
class AdminNotificationSamplesController {
  constructor(private readonly service: NotificationSamplesService) {}
  @Get()
  async list(@Query() query: NotificationSampleQueryDto) { return { success: true, data: await this.service.list(query) }; }
  @Get('export')
  async export(@Query() query: NotificationSampleQueryDto) { return { success: true, data: await this.service.export(query) }; }
}

@Module({ imports: [PrismaModule, AdminModule, AuthModule], controllers: [NotificationSamplesController, AdminNotificationSamplesController], providers: [NotificationSamplesService] })
export class NotificationSamplesModule {}
