import { Module } from '@nestjs/common';
import { AuditLogController, DeadLetterController, HealthController } from './ops.controllers';

@Module({ controllers: [HealthController, DeadLetterController, AuditLogController] })
export class OpsModule {}
