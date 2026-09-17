import { DeviceSessionService } from './device-session.service';
import { DeviceChallengeDto, DeviceRenewDto } from './dto/device-session.dto';
import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync } from 'fs';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { BiometricLoginDto, EnrollBiometricDto } from './dto/biometric-login.dto';

// 确保上传目录存在
const uploadDir = './uploads/avatars';
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
}

// Multer 配置
const avatarStorage = diskStorage({
  destination: uploadDir,
  filename: (req, file, callback) => {
    const uniqueName = `${uuidv4()}${extname(file.originalname)}`;
    callback(null, uniqueName);
  },
});

const imageFileFilter = (
  req: any,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
    return callback(
      new BadRequestException('只支持 jpg、jpeg、png、gif、webp 格式的图片'),
      false,
    );
  }
  callback(null, true);
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly devices: DeviceSessionService) {}

  @Public()
  @Post('device/challenge')
  @HttpCode(200)
  async deviceChallenge(@Body() dto: DeviceChallengeDto) {
    return { success: true, data: { challenge: await this.devices.challenge(dto.sessionId) } };
  }
  @Public()
  @Post('device/renew')
  @HttpCode(200)
  async deviceRenew(@Body() dto: DeviceRenewDto) {
    return { success: true, data: { token: await this.devices.renew(dto.challenge, dto.signature) } };
  }
  @Post('device/logout')
  @HttpCode(200)
  async deviceLogout(@CurrentUser('id') userId: string, @CurrentUser('deviceSessionId') sid?: string) {
    if (sid) await this.devices.revoke(sid, userId);
    return { success: true };
  }

  /**
   * 用户注册
   * POST /auth/register
   */
  @Public()
  @Post('register')
  @ApiOperation({
    summary: '用户注册',
    description: '创建新用户账号',
  })
  @ApiResponse({ status: 201, description: '注册成功' })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  @ApiResponse({ status: 409, description: '用户名或邮箱已存在' })
  async register(@Body() dto: RegisterDto) {
    const result = await this.authService.register(dto);

    return {
      success: true,
      message: '注册成功',
      data: result,
    };
  }

  /**
   * 用户登录
   * POST /auth/login
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '用户登录',
    description: '使用用户名和密码登录',
  })
  @ApiResponse({ status: 200, description: '登录成功' })
  @ApiResponse({ status: 401, description: '用户名或密码错误' })
  async login(@Body() dto: LoginDto) {
    const result = await this.authService.login(dto);

    return {
      success: true,
      message: '登录成功',
      data: result,
    };
  }

  /** 使用设备侧生物识别验证后释放的设备凭据登录。原始指纹数据不会离开设备。 */
  @Public()
  @Post('biometric/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '生物识别登录', description: '使用指纹或人脸验证后登录已绑定账号' })
  async biometricLogin(@Body() dto: BiometricLoginDto) {
    const result = await this.authService.biometricLogin(dto);
    return { success: true, message: '生物识别登录成功', data: result };
  }

  /** 将当前设备绑定到当前账号。服务端只保存设备凭据哈希。 */
  @Post('biometric/enroll')
  @ApiBearerAuth()
  @ApiOperation({ summary: '绑定生物识别登录', description: '服务端仅保存随机设备凭据的哈希' })
  async enrollBiometric(
    @CurrentUser('id') userId: string,
    @Body() dto: EnrollBiometricDto,
  ) {
    const result = await this.authService.enrollBiometric(userId, dto);
    return { success: true, message: '生物识别登录已绑定', data: result };
  }

  @Delete('biometric')
  @ApiBearerAuth()
  @ApiOperation({ summary: '解除生物识别登录绑定' })
  async revokeBiometric(@CurrentUser('id') userId: string) {
    await this.authService.revokeBiometric(userId);
    return { success: true, message: '生物识别登录已解除' };
  }

  /**
   * 获取当前用户信息
   * GET /auth/profile
   */
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '获取用户信息',
    description: '获取当前登录用户的详细信息',
  })
  @ApiResponse({ status: 200, description: '获取成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  async getProfile(@CurrentUser('id') userId: string) {
    const user = await this.authService.getProfile(userId);

    return {
      success: true,
      message: '获取用户信息成功',
      data: user,
    };
  }

  /**
   * 更新用户资料
   * PATCH /auth/profile
   */
  @Patch('profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '更新用户资料',
    description: '更新当前用户的昵称、用户名、邮箱或头像',
  })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  @ApiResponse({ status: 401, description: '未授权' })
  @ApiResponse({ status: 409, description: '用户名或邮箱已存在' })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const user = await this.authService.updateProfile(userId, dto);

    return {
      success: true,
      message: '资料更新成功',
      data: user,
    };
  }

  /**
   * 修改密码
   * PATCH /auth/password
   */
  @Patch('password')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '修改密码',
    description: '修改当前用户的密码',
  })
  @ApiResponse({ status: 200, description: '密码修改成功' })
  @ApiResponse({ status: 400, description: '当前密码错误或参数错误' })
  @ApiResponse({ status: 401, description: '未授权' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(userId, dto);

    return {
      success: true,
      message: '密码修改成功',
    };
  }

  /**
   * 上传头像
   * POST /auth/avatar
   */
  @Post('avatar')
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: avatarStorage,
      fileFilter: imageFileFilter,
      limits: {
        fileSize: 5 * 1024 * 1024, // 最大 5MB
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '上传头像',
    description: '上传用户头像图片，支持 jpg、png、gif、webp 格式，最大 5MB',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        avatar: {
          type: 'string',
          format: 'binary',
          description: '头像图片文件',
        },
      },
      required: ['avatar'],
    },
  })
  @ApiResponse({ status: 201, description: '上传成功' })
  @ApiResponse({ status: 400, description: '文件格式不支持或文件过大' })
  @ApiResponse({ status: 401, description: '未授权' })
  async uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('请选择要上传的图片');
    }

    // 构建头像 URL
    const avatarUrl = `/uploads/avatars/${file.filename}`;

    // 更新用户头像
    const user = await this.authService.updateProfile(userId, {
      avatar: avatarUrl,
    });

    return {
      success: true,
      message: '头像上传成功',
      data: {
        avatar: avatarUrl,
        user,
      },
    };
  }
}
