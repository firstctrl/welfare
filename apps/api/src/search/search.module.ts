import { Module } from '@nestjs/common';
import { StaffModule } from '../staff/staff.module';
import { LoansModule } from '../loans/loans.module';
import { ClaimsModule } from '../claims/claims.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [StaffModule, LoansModule, ClaimsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
