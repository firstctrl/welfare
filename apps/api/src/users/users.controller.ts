import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
import { UsersService } from './users.service';

// Guards will be applied globally in Phase 1.1 — stubs for now
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  create(@Body() body: { username: string; displayName: string; email?: string; password: string }) {
    return this.usersService.createLocal(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { displayName?: string; email?: string; isActive?: boolean },
  ) {
    return this.usersService.updateUser(id, body);
  }
}
