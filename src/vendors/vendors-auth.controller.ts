import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { CookieOptions, Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigType } from '@nestjs/config';
import {
  AccessGuard,
  AuthenticatedRequest,
  BaseController,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  UserType,
  UtilsService,
} from '@Common';
import { appConfigFactory, authConfigFactory } from '@Config';
import {
  VendorAuthSendOtpRequestDto,
  VendorLoginRequestDto,
  VendorRegisterRequestDto,
} from './dto';
import { VendorsService } from './vendors.service';

@ApiTags('Vendor Auth')
@Controller('vendor-auth')
export class VendorsAuthController extends BaseController {
  constructor(
    @Inject(appConfigFactory.KEY)
    private readonly appConfig: ConfigType<typeof appConfigFactory>,
    @Inject(authConfigFactory.KEY)
    private readonly authConfig: ConfigType<typeof authConfigFactory>,
    private readonly vendorsService: VendorsService,
    private readonly utilsService: UtilsService,
  ) {
    super();
  }

  private getCookieOptions(options?: CookieOptions) {
    const isProduction = this.utilsService.isProduction();
    return {
      expires: options?.expires,
      domain:
        options?.domain !== undefined ? options.domain : this.appConfig.domain,
      httpOnly: options?.httpOnly !== undefined ? options.httpOnly : true,
      sameSite:
        options?.sameSite !== undefined
          ? options.sameSite
          : isProduction
            ? 'strict'
            : 'none',
      secure: options?.secure !== undefined ? options.secure : true,
    };
  }

  private setCookie(
    res: Response,
    key: string,
    value: string,
    options?: CookieOptions,
  ): void {
    res.cookie(key, value, this.getCookieOptions(options));
  }

  private removeCookie(
    res: Response,
    key: string,
    options?: CookieOptions,
  ): void {
    res.clearCookie(key, this.getCookieOptions(options));
  }

  private getAuthCookie(ut: UserType) {
    return this.utilsService.getCookiePrefix(ut) + 'authToken';
  }

  private setAuthCookie(res: Response, accessToken: string): void {
    this.setCookie(res, this.getAuthCookie(UserType.Vendor), accessToken, {
      expires: this.authConfig.authCookieExpirationTime(),
    });
  }

  @Post('send-otp')
  async sendOtp(@Body() data: VendorAuthSendOtpRequestDto) {
    return await this.vendorsService.sendOtp(data.mobile);
  }

  @Post('register')
  async register(
    @Res({ passthrough: true }) res: Response,
    @Body() data: VendorRegisterRequestDto,
  ) {
    const response = await this.vendorsService.register(data);
    console.log('data', data);
    this.setAuthCookie(res, response.accessToken);
    return response;
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Res({ passthrough: true }) res: Response,
    @Body() data: VendorLoginRequestDto,
  ) {
    console.log('data', data);
    const response = await this.vendorsService.login(
      data.mobile,
      data.password,
    );
    this.setAuthCookie(res, response.accessToken);
    return response;
  }

  @ApiBearerAuth()
  @Roles(UserType.Vendor)
  @UseGuards(JwtAuthGuard, AccessGuard, RolesGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.getContext(req);
    await this.vendorsService.logout(ctx.user.id);
    this.removeCookie(res, this.getAuthCookie(UserType.Vendor));
    return { status: 'success' };
  }
}
