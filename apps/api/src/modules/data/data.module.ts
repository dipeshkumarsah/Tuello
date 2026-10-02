import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ImportsController } from './imports.controller';

@Module({ controllers: [ImportsController, ExportsController] })
export class DataModule {}
