import { Global, Module } from '@nestjs/common';
import { ImportProgressController } from './import-progress.controller';
import { ImportProgressService } from './import-progress.service';

@Global()
@Module({
  controllers: [ImportProgressController],
  providers: [ImportProgressService],
  exports: [ImportProgressService],
})
export class ImportProgressModule {}
