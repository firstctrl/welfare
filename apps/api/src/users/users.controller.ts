import { Controller, Get, Post, Patch, Body, Param, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { AppModule, UserRole, AuditAction, AuditEntity } from '@welfare/shared';
import { UserDocument } from './schemas/user.schema';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission(AppModule.UserManagement, 'readonly')
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @RequirePermission(AppModule.UserManagement, 'readonly')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @RequirePermission(AppModule.UserManagement, 'full')
  create(@Body() body: { username: string; displayName: string; email?: string; password: string }) {
    return this.usersService.createLocal(body);
  }

  @Patch(':id')
  @RequirePermission(AppModule.UserManagement, 'full')
  update(
    @Param('id') id: string,
    @Body() body: { displayName?: string; email?: string; isActive?: boolean },
  ) {
    return this.usersService.updateUser(id, body);
  }

  @Patch(':id/role')
  @Roles(UserRole.Admin, UserRole.WelfareManager)
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ) {
    const target = await this.usersService.findById(id);
    const oldRole = target?.role;
    const updated = await this.usersService.updateRole(id, dto.role);
    await this.auditService.log(
      actor._id.toString(),
      actor.displayName,
      AuditAction.Update,
      AuditEntity.User,
      id,
      { role: oldRole },
      { role: dto.role },
      req.ip,
    );
    return updated;
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.Admin, UserRole.WelfareManager)
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ) {
    await this.usersService.resetPassword(id, dto.password);
    await this.auditService.log(
      actor._id.toString(),
      actor.displayName,
      AuditAction.Update,
      AuditEntity.User,
      id,
      undefined,
      { passwordReset: true },
      req.ip,
    );
  }
}
