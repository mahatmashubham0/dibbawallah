import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
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
import { WalletService } from './wallet.service';
import {
  ConfigureWalletDto,
  RechargeWalletDto,
  UpdateDeliveryStatusDto,
} from './dto/wallet.dto';

@ApiTags('Wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('wallets')
export class WalletController extends BaseController {
  constructor(private readonly walletService: WalletService) {
    super();
  }

  // ==========================================
  // VENDOR ENDPOINTS
  // ==========================================

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Post('vendor/configure/:vendorCustomerId')
  async configureWallet(
    @Param('vendorCustomerId', ParseIntPipe) vendorCustomerId: number,
    @Body() data: ConfigureWalletDto,
  ) {
    return await this.walletService.configureWallet(vendorCustomerId, data);
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Post('vendor/recharge/:vendorCustomerId')
  async rechargeWallet(
    @Param('vendorCustomerId', ParseIntPipe) vendorCustomerId: number,
    @Body() data: RechargeWalletDto,
  ) {
    return await this.walletService.rechargeWallet(vendorCustomerId, data);
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Patch('vendor/deliveries/:deliveryId/status')
  async updateDeliveryStatus(
    @Req() req: AuthenticatedRequest,
    @Param('deliveryId') deliveryId: string,
    @Body() data: UpdateDeliveryStatusDto,
  ) {
    const ctx = this.getContext(req);
    return await this.walletService.processMealDelivery(
      ctx.user.id,
      BigInt(deliveryId),
      data.status,
    );
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Get('vendor/dashboard')
  async getVendorDashboard(@Req() req: AuthenticatedRequest) {
    const ctx = this.getContext(req);
    return await this.walletService.getVendorDashboard(ctx.user.id);
  }

  // ==========================================
  // USER ENDPOINTS
  // ==========================================

  @Roles(UserType.User)
  @UseGuards(RolesGuard)
  @Get('user/dashboard/:vendorCustomerId')
  async getCustomerDashboard(
    @Param('vendorCustomerId', ParseIntPipe) vendorCustomerId: number,
  ) {
    return await this.walletService.getCustomerDashboard(vendorCustomerId);
  }
}
