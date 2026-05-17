import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';

export const MEILISEARCH_CLIENT = 'MEILISEARCH_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: MEILISEARCH_CLIENT,
      useFactory: (configService: ConfigService): MeiliSearch => {
        return new MeiliSearch({
          host: configService.get<string>('meilisearch.host') as string,
          apiKey: configService.get<string>('meilisearch.apiKey'),
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [MEILISEARCH_CLIENT],
})
export class MeilisearchModule {}
