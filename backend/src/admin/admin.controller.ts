import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { AdminAccessGuard } from './admin-access.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import {
  AdminIssueQueryDto,
  AdminLoginDto,
  AdminUserQueryDto,
  CreateAdminIssueDto,
  CreateAdminUserDto,
  CreateAdminVersionDto,
  CreateSystemSettingDto,
  UpdateAdminIssueDto,
  UpdateAdminUserDto,
  UpdateAdminVersionDto,
  UpdateSystemSettingDto,
} from './dto/admin.dto';

@ApiTags('admin')
@Public()
@Controller('admin-api/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  login(@Body() dto: AdminLoginDto) {
    return { success: true, data: this.auth.login(dto) };
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Public()
@UseGuards(AdminAccessGuard)
@Controller('admin-api')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('session')
  session(@Req() request: Request & { admin?: { username?: string } }) {
    return { success: true, data: { username: request.admin?.username || 'admin' } };
  }

  @Get('dashboard')
  async dashboard() { return { success: true, data: await this.admin.getDashboard() }; }

  @Get('users')
  async users(@Query() query: AdminUserQueryDto) { return { success: true, data: await this.admin.listUsers(query) }; }

  @Post('users')
  async createUser(@Body() dto: CreateAdminUserDto) { return { success: true, data: await this.admin.createUser(dto) }; }

  @Patch('users/:id')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateAdminUserDto) { return { success: true, data: await this.admin.updateUser(id, dto) }; }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) { await this.admin.deleteUser(id); return { success: true }; }

  @Get('versions')
  async versions() { return { success: true, data: await this.admin.listVersions() }; }

  @Post('versions')
  async createVersion(@Body() dto: CreateAdminVersionDto) { return { success: true, data: await this.admin.createVersion(dto) }; }

  @Patch('versions/:id')
  async updateVersion(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAdminVersionDto) { return { success: true, data: await this.admin.updateVersion(id, dto) }; }

  @Delete('versions/:id')
  async deleteVersion(@Param('id', ParseIntPipe) id: number) { await this.admin.deleteVersion(id); return { success: true }; }

  @Get('settings')
  async settings() { return { success: true, data: await this.admin.listSettings() }; }

  @Post('settings')
  async createSetting(@Body() dto: CreateSystemSettingDto) { return { success: true, data: await this.admin.createSetting(dto) }; }

  @Patch('settings/:id')
  async updateSetting(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSystemSettingDto) { return { success: true, data: await this.admin.updateSetting(id, dto) }; }

  @Delete('settings/:id')
  async deleteSetting(@Param('id', ParseIntPipe) id: number) { await this.admin.deleteSetting(id); return { success: true }; }

  @Get('issues')
  async issues(@Query() query: AdminIssueQueryDto) { return { success: true, data: await this.admin.listIssues(query) }; }

  @Post('issues')
  async createIssue(@Body() dto: CreateAdminIssueDto) { return { success: true, data: await this.admin.createIssue(dto) }; }

  @Patch('issues/:id')
  async updateIssue(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAdminIssueDto) { return { success: true, data: await this.admin.updateIssue(id, dto) }; }

  @Delete('issues/:id')
  async deleteIssue(@Param('id', ParseIntPipe) id: number) { await this.admin.deleteIssue(id); return { success: true }; }
}
