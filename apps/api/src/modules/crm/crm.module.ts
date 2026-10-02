import { Module } from '@nestjs/common';
import { BrokeragesController } from './brokerages.controller';
import { ClientsController } from './clients.controller';
import { CrmService } from './crm.service';
import { SavedViewsController, TagsController } from './tags-views.controller';

@Module({
  controllers: [ClientsController, BrokeragesController, TagsController, SavedViewsController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}
