import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { AddCustomerDto, GetVendorsRequestDto, UpdateVendorProfileRequestDto } from './dto';
import { VendorsService } from './vendors.service';

@ApiTags('Vendors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('vendors')
export class VendorsController extends BaseController {
  constructor(private readonly vendorsService: VendorsService) {
    super();
  }


  @Roles(UserType.Admin)
  @UseGuards(RolesGuard)
  @Get()
  async getAllVendors(@Query() query: GetVendorsRequestDto) {
    return await this.vendorsService.getAllVendors({
      search: query.search,
      skip: query.skip,
      take: query.take,
    });
  }

  @UseGuards(JwtAuthGuard, AccessGuard, RolesGuard)
  @Roles(UserType.Vendor)
  @Get('me')
  async getProfile(@Req() req: AuthenticatedRequest) {
    const ctx = this.getContext(req);
    return await this.vendorsService.getProfile(ctx.user.id);
  }

  @UseGuards(JwtAuthGuard, AccessGuard, RolesGuard)
  @Roles(UserType.Vendor)
  @Patch('me')
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() data: UpdateVendorProfileRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.vendorsService.updateProfile(ctx.user.id, data);
  }

  @UseGuards(JwtAuthGuard, AccessGuard, RolesGuard)
  @Roles(UserType.Vendor)
  @Get('me/invite')
  async getInvite(@Req() req: AuthenticatedRequest) {
    const ctx = this.getContext(req);
    return await this.vendorsService.getInvite(ctx.user.id);
  }

  @Get('invite/:inviteCode')
  async getInvitePreview(@Param('inviteCode') inviteCode: string) {
    return await this.vendorsService.getInvitePreview(inviteCode);
  }

  @UseGuards(JwtAuthGuard, AccessGuard, RolesGuard)
  @Roles(UserType.Vendor)
  @Post('me/customers/import')
  @UseInterceptors(FileInterceptor('file'))
  async importCustomers(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const ctx = this.getContext(req);
    return await this.vendorsService.importCustomers(ctx.user.id, file.buffer);
  }

  @UseGuards(JwtAuthGuard, AccessGuard, RolesGuard)
  @Roles(UserType.Vendor)
  @Post('me/customers')
  async addCustomer(
    @Req() req: AuthenticatedRequest,
    @Body() data: AddCustomerDto,
  ) {
    const ctx = this.getContext(req);
    return await this.vendorsService.addCustomer(ctx.user.id, data);
  }
}
