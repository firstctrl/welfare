import { Controller, Get, Param, Query } from '@nestjs/common';
import { LoansService } from './loans.service';

@Controller('staff')
export class StaffLoansController {
  constructor(private readonly loansService: LoansService) {}

  @Get(':staffId/loans')
  getLoanHistory(
    @Param('staffId') staffId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.loansService.findByStaff(
      staffId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
