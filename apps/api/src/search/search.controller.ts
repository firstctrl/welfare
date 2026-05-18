import { Controller, Get, Inject, Query } from '@nestjs/common';
import { MeiliSearch } from 'meilisearch';
import { MEILISEARCH_CLIENT } from './meilisearch.module';

@Controller('search')
export class SearchController {
  constructor(
    @Inject(MEILISEARCH_CLIENT) private readonly meili: MeiliSearch,
  ) {}

  @Get()
  async search(
    @Query('q') q: string = '',
    @Query('type') type: string = 'staff',
    @Query('status') status?: string,
    @Query('level') level?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const index = this.meili.index(type);
    const filter: string[] = [];
    if (status) filter.push(`status = "${status}"`);
    if (level) filter.push(`level = "${level}"`);
    const result = await index.search(q, {
      filter: filter.length ? filter.join(' AND ') : undefined,
      limit: parseInt(limit, 10),
      offset: (parseInt(page, 10) - 1) * parseInt(limit, 10),
    });
    return {
      data: result.hits,
      total: result.estimatedTotalHits ?? 0,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    };
  }
}
