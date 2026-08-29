import { IsNotEmpty, IsString } from 'class-validator';

export class RejectClaimDto {
  @IsString() @IsNotEmpty() reason!: string;
}
