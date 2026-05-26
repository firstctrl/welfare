import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { RemittancesController } from './remittances.controller';
import { RemittancesService } from './remittances.service';
import { RemittancesImportService } from './remittances.import.service';
import { Remittance, RemittanceSchema } from './schemas/remittance.schema';
import { RemittanceImportBatch, RemittanceImportBatchSchema } from './schemas/remittance-import-batch.schema';
import { Contribution, ContributionSchema } from '../contributions/schemas/contribution.schema';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Remittance.name, schema: RemittanceSchema },
      { name: RemittanceImportBatch.name, schema: RemittanceImportBatchSchema },
      { name: Contribution.name, schema: ContributionSchema },
    ]),
    MulterModule.register({}),
    SystemConfigModule,
  ],
  controllers: [RemittancesController],
  providers: [RemittancesService, RemittancesImportService],
})
export class RemittancesModule {}
