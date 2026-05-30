import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AccessGuard,
  AuthenticatedRequest,
  BaseController,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  UserType,
} from '@Common';
import { UpdateVendorProfileRequestDto } from './dto';
import { VendorsService } from './vendors.service';

@ApiTags('Vendors')
@ApiBearerAuth()
@Controller('vendors')
export class VendorsController extends BaseController {
  constructor(private readonly vendorsService: VendorsService) {
    super();
  }

  @UseGuards(JwtAuthGuard, AccessGuard)
  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Get('me')
  async getProfile(@Req() req: AuthenticatedRequest) {
    const ctx = this.getContext(req);
    return await this.vendorsService.getProfile(ctx.user.id);
  }

  @UseGuards(JwtAuthGuard, AccessGuard)
  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Patch('me')
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() data: UpdateVendorProfileRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.vendorsService.updateProfile(ctx.user.id, data);
  }

  @UseGuards(JwtAuthGuard, AccessGuard)
  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Get('me/invite')
  async getInvite(@Req() req: AuthenticatedRequest) {
    const ctx = this.getContext(req);
    return await this.vendorsService.getInvite(ctx.user.id);
  }

  @Get('invite/:inviteCode')
  async getInvitePreview(@Param('inviteCode') inviteCode: string) {
    return await this.vendorsService.getInvitePreview(inviteCode);
  }
}
