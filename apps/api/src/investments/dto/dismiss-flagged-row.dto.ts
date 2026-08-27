import { IsInt, Min } from 'class-validator';

export class DismissFlaggedRowDto {
  @IsInt() @Min(0) index!: number;
}
