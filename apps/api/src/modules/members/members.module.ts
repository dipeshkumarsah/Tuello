import { Module } from '@nestjs/common';
import { InvitesController } from './invites.controller';
import { MembersController } from './members.controller';

@Module({ controllers: [MembersController, InvitesController] })
export class MembersModule {}
