import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

export const MINIO_CLIENT = 'MINIO_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: MINIO_CLIENT,
      useFactory: (configService: ConfigService): Client => {
        return new Client({
          endPoint: configService.get<string>('minio.endPoint') as string,
          port: configService.get<number>('minio.port'),
          useSSL: configService.get<boolean>('minio.useSSL'),
          accessKey: configService.get<string>('minio.accessKey') as string,
          secretKey: configService.get<string>('minio.secretKey') as string,
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [MINIO_CLIENT],
})
export class MinioModule {}
