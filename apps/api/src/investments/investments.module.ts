import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';
import { InvestmentsImportService } from './investments.import.service';
import { Investment, InvestmentSchema } from './schemas/investment.schema';
import { InvestmentImportBatch, InvestmentImportBatchSchema } from './schemas/investment-import-batch.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Investment.name, schema: InvestmentSchema },
      { name: InvestmentImportBatch.name, schema: InvestmentImportBatchSchema },
    ]),
    MulterModule.register({}),
  ],
  controllers: [InvestmentsController],
  providers: [InvestmentsService, InvestmentsImportService],
})
export class InvestmentsModule {}
