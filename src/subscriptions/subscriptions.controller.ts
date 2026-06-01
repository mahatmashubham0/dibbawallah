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
import { SubscriptionsService } from './subscriptions.service';
import {
  CreateSubscriptionRequestDto,
  RespondToSubscriptionRequestDto,
} from './dto';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('subscriptions')
export class SubscriptionsController extends BaseController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {
    super();
  }

  // ==========================================
  // DISCOVERY ENDPOINTS (USER ROLE)
  // ==========================================

  @Roles(UserType.User)
  @UseGuards(RolesGuard)
  @Get('vendors/search')
  async searchVendors(@Query('q') query: string) {
    return await this.subscriptionsService.searchVendors(query || '');
  }

  @Roles(UserType.User)
  @UseGuards(RolesGuard)
  @Get('vendors/invite/:inviteCode')
  async findVendorByInviteCode(@Param('inviteCode') inviteCode: string) {
    return await this.subscriptionsService.findVendorByInviteCode(inviteCode);
  }

  @Roles(UserType.User)
  @UseGuards(RolesGuard)
  @Get('vendors/:vendorId')
  async getVendorProfile(@Param('vendorId', ParseIntPipe) vendorId: number) {
    return await this.subscriptionsService.getVendorProfile(vendorId);
  }



  // ==========================================
  // SUBSCRIPTION REQUESTS ENDPOINTS
  // ==========================================

  @Roles(UserType.User)
  @UseGuards(RolesGuard)
  @Post('requests')
  async createRequest(
    @Req() req: AuthenticatedRequest,
    @Body() data: CreateSubscriptionRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.createRequest(
      ctx.user.id,
      data.planId,
      data.paymentProofUrl,
    );
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Patch('requests/:requestId/respond')
  async respondToRequest(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() data: RespondToSubscriptionRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.respondToRequest(
      ctx.user.id,
      requestId,
      data.status,
      data.declineReason,
    );
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Get('requests/pending')
  async getPendingRequests(@Req() req: AuthenticatedRequest) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.getPendingRequests(ctx.user.id);
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Get('requests/:requestId/payment-proof')
  async getPaymentProof(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseIntPipe) requestId: number,
  ) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.getPaymentProof(ctx.user.id, requestId);
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Patch('settings/accepting-requests')
  async toggleVendorAcceptance(
    @Req() req: AuthenticatedRequest,
    @Body('accepting') accepting: boolean,
  ) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.toggleVendorAcceptance(
      ctx.user.id,
      accepting,
    );
  }
}
