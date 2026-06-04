import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
  CreateRefundRequestDto,
  ProcessRefundRequestDto,
  CreatePauseRequestDto,
  UpdateDeliveryStatusDto,
} from './dto/wallet.dto';
import { DeliveryStatus, PauseRequestStatus } from '@prisma/client';

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
    @Param('deliveryId', ParseIntPipe) deliveryId: number,
    @Body() data: UpdateDeliveryStatusDto,
  ) {
    const ctx = this.getContext(req);
    return await this.walletService.processMealDelivery(ctx.user.id, deliveryId, data.status);
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Patch('vendor/refund-requests/:requestId/respond')
  async respondToRefundRequest(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() data: ProcessRefundRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.walletService.processRefundRequest(ctx.user.id, requestId, data);
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Patch('vendor/pause-requests/:requestId/respond')
  async respondToPauseRequest(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body('status') status: PauseRequestStatus,
  ) {
    const ctx = this.getContext(req);
    return await this.walletService.processPauseRequest(ctx.user.id, requestId, status);
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
  @Post('user/refund-requests/:vendorCustomerId')
  async createRefundRequest(
    @Req() req: AuthenticatedRequest,
    @Param('vendorCustomerId', ParseIntPipe) vendorCustomerId: number,
    @Body() data: CreateRefundRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.walletService.createRefundRequest(ctx.user.id, vendorCustomerId, data);
  }

  @Roles(UserType.User)
  @UseGuards(RolesGuard)
  @Post('user/pause-requests/:subscriptionId')
  async createPauseRequest(
    @Req() req: AuthenticatedRequest,
    @Param('subscriptionId', ParseIntPipe) subscriptionId: number,
    @Body() data: CreatePauseRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.walletService.createPauseRequest(ctx.user.id, subscriptionId, data);
  }

  @Roles(UserType.User)
  @UseGuards(RolesGuard)
  @Patch('user/subscriptions/:subscriptionId/resume')
  async resumeSubscription(
    @Req() req: AuthenticatedRequest,
    @Param('subscriptionId', ParseIntPipe) subscriptionId: number,
  ) {
    const ctx = this.getContext(req);
    return await this.walletService.resumeSubscription(ctx.user.id, subscriptionId);
  }

  @Roles(UserType.User)
  @UseGuards(RolesGuard)
  @Post('user/subscriptions/:subscriptionId/cancel')
  async cancelSubscription(
    @Param('subscriptionId', ParseIntPipe) subscriptionId: number,
    @Query('vendorCustomerId', ParseIntPipe) vendorCustomerId: number,
    @Query('refund') refund: boolean,
  ) {
    return await this.walletService.cancelSubscription(vendorCustomerId, subscriptionId, refund);
  }

  @Roles(UserType.User)
  @UseGuards(RolesGuard)
  @Get('user/dashboard/:vendorCustomerId')
  async getCustomerDashboard(
    @Param('vendorCustomerId', ParseIntPipe) vendorCustomerId: number,
  ) {
    return await this.walletService.getCustomerDashboard(vendorCustomerId);
  }
}
