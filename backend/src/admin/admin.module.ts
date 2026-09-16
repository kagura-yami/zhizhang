import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAccessGuard } from './admin-access.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminService, AdminAuthService, AdminAccessGuard],
  exports: [AdminAccessGuard],
})
export class AdminModule {}
