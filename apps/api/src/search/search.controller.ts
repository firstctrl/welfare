import { Controller, Get, Post, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query('q') q: string = '') {
    return this.searchService.search(q);
  }

  @Public()
  @Post('reindex')
  reindex() {
    return this.searchService.reindex();
  }
}
