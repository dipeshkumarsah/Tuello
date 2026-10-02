import { Global, Module } from '@nestjs/common';
import { AuditService, EventsService } from './events.service';

@Global()
@Module({ providers: [EventsService, AuditService], exports: [EventsService, AuditService] })
export class EventsModule {}
