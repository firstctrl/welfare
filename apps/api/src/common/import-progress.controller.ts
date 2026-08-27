import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ImportProgressService } from './import-progress.service';

@Controller('import-progress')
export class ImportProgressController {
  constructor(private readonly progressService: ImportProgressService) {}

  @Get(':jobId')
  get(@Param('jobId') jobId: string) {
    const progress = this.progressService.get(jobId);
    if (!progress) throw new NotFoundException(`No progress found for job ${jobId}`);
    return progress;
  }
}
