import { IsEnum } from 'class-validator';
import { UserRole } from '@welfare/shared';

export class UpdateRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}
