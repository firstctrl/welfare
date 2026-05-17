import { IsString, IsNotEmpty, MaxLength, IsMongoId } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}

export class RefreshDto {
  @IsMongoId()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  refreshToken!: string;
}
