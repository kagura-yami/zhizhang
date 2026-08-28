import { Module } from '@nestjs/common';
import { InvoiceMailboxController } from './invoice-mailbox.controller';
import { InvoiceMailboxService } from './invoice-mailbox.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InvoiceMailboxController],
  providers: [InvoiceMailboxService],
  exports: [InvoiceMailboxService],
})
export class InvoiceMailboxModule {}
