import { Body, Controller, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthUser } from '@ctp/types';
import { CurrentUser, RequestUser } from '../common/decorators/auth.decorators';
import { ChangePasswordDto, UpdateProfileDto } from './dto/users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('me')
  updateMe(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto, @Req() req: Request): Promise<AuthUser> {
    return this.users.updateProfile(user.id, dto, req);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('me/password')
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto, @Req() req: Request): Promise<void> {
    return this.users.changePassword(user, dto, req);
  }
}
