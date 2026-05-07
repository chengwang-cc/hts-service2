import {
  Controller,
  Post,
  Body,
  ConflictException,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ExtensionAuthService } from './extension-auth.service';
import { ExtensionRegisterDto } from './dto/extension-register.dto';
import { ExtensionLoginDto } from './dto/extension-login.dto';

/**
 * Extension Auth Controller
 * Public endpoints for the Chrome extension to register/login and receive an API key.
 * No JWT required — these are the entry points for first-time users.
 */
@ApiTags('Extension Auth')
@Controller('api/v1/extension-auth')
export class ExtensionAuthController {
  constructor(private readonly extensionAuthService: ExtensionAuthService) {}

  /**
   * Register a new account and receive an extension API key.
   * POST /api/v1/extension-auth/register
   */
  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new account and get an extension API key' })
  @ApiResponse({ status: 201, description: 'Registration successful — API key returned' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async register(@Body() dto: ExtensionRegisterDto) {
    try {
      const result = await this.extensionAuthService.register(
        dto.email,
        dto.password,
        dto.firstName,
        dto.lastName,
      );
      return {
        success: true,
        data: result,
        meta: { apiVersion: 'v1' },
      };
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      throw err;
    }
  }

  /**
   * Login and receive the extension API key.
   * POST /api/v1/extension-auth/login
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and get the extension API key' })
  @ApiResponse({ status: 200, description: 'Login successful — API key returned' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: ExtensionLoginDto) {
    try {
      const result = await this.extensionAuthService.login(dto.email, dto.password);
      return {
        success: true,
        data: result,
        meta: { apiVersion: 'v1' },
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw err;
    }
  }
}
