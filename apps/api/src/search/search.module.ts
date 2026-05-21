import { Module } from '@nestjs/common';
import { StaffModule } from '../staff/staff.module';
import { LoansModule } from '../loans/loans.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [StaffModule, LoansModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
