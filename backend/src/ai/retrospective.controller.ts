import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateRetrospectiveDto,
  RetrospectivePageDto,
} from './dto/retrospective.dto';
import { RetrospectiveJobsService } from './services/retrospective-jobs.service';

@Controller('ai/retrospectives')
export class RetrospectiveController {
  constructor(private readonly jobs: RetrospectiveJobsService) {}
  @Post() async create(
    @CurrentUser('id') userId: string,
    @Body() body: CreateRetrospectiveDto,
  ) {
    return { success: true, data: await this.jobs.create(userId, body) };
  }
  @Get() async list(
    @CurrentUser('id') userId: string,
    @Query() query: RetrospectivePageDto,
  ) {
    return { success: true, data: await this.jobs.list(userId, query) };
  }
  @Get(':id') async detail(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { success: true, data: await this.jobs.detail(userId, id) };
  }
  @Post(':id/retry') async retry(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { success: true, data: await this.jobs.retry(userId, id) };
  }
  @Delete(':id') async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { success: true, data: await this.jobs.remove(userId, id) };
  }
}
