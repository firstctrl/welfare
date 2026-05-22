import { UserRole } from '../enums/user-role.enum';
import { AppModule } from '../enums/app-module.enum';

export type AccessLevel = 'full' | 'readonly' | 'none';
export type PermissionMatrix = Record<UserRole, Record<AppModule, AccessLevel>>;

export const PERMISSIONS: PermissionMatrix = {
  [UserRole.WelfareOfficer]: {
    [AppModule.Contributions]:  'full',
    [AppModule.Staff]:          'full',
    [AppModule.Loans]:          'full',
    [AppModule.Reports]:        'full',
    [AppModule.Settings]:       'full',
    [AppModule.AuditLog]:       'none',
    [AppModule.EmailLog]:       'none',
    [AppModule.UserManagement]: 'none',
  },
  [UserRole.WelfareManager]: {
    [AppModule.Contributions]:  'full',
    [AppModule.Staff]:          'full',
    [AppModule.Loans]:          'full',
    [AppModule.Reports]:        'full',
    [AppModule.Settings]:       'full',
    [AppModule.AuditLog]:       'full',
    [AppModule.EmailLog]:       'full',
    [AppModule.UserManagement]: 'full',
  },
  [UserRole.WelfareDirector]: {
    [AppModule.Contributions]:  'readonly',
    [AppModule.Staff]:          'readonly',
    [AppModule.Loans]:          'readonly',
    [AppModule.Reports]:        'readonly',
    [AppModule.Settings]:       'none',
    [AppModule.AuditLog]:       'readonly',
    [AppModule.EmailLog]:       'readonly',
    [AppModule.UserManagement]: 'none',
  },
  [UserRole.Admin]: {
    [AppModule.Contributions]:  'full',
    [AppModule.Staff]:          'full',
    [AppModule.Loans]:          'full',
    [AppModule.Reports]:        'full',
    [AppModule.Settings]:       'full',
    [AppModule.AuditLog]:       'full',
    [AppModule.EmailLog]:       'full',
    [AppModule.UserManagement]: 'full',
  },
};
