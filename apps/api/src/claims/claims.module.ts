import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { ImportService } from './import.service';
import { Claim, ClaimSchema } from './schemas/claim.schema';
import { ClaimImportBatch, ClaimImportBatchSchema } from './schemas/claim-import-batch.schema';
import { Contribution, ContributionSchema } from '../contributions/schemas/contribution.schema';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Claim.name, schema: ClaimSchema },
      { name: ClaimImportBatch.name, schema: ClaimImportBatchSchema },
      { name: Contribution.name, schema: ContributionSchema },
    ]),
    MulterModule.register({}),
    StaffModule,
  ],
  controllers: [ClaimsController],
  providers: [ClaimsService, ImportService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
