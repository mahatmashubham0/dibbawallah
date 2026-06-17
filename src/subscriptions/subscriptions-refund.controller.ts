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
  CreateRefundRequestDto,
  ProcessRefundRequestDto,
  GetRefundRequestsQueryDto,
} from './dto';

@ApiTags('Subscriptions Refund')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('subscriptions')
export class SubscriptionsRefundController extends BaseController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {
    super();
  }

  @Roles(UserType.User, UserType.Vendor)
  @UseGuards(RolesGuard)
  @Post('refund-requests/:vendorCustomerId')
  async createRefundRequest(
    @Req() req: AuthenticatedRequest,
    @Param('vendorCustomerId', ParseIntPipe) vendorCustomerId: number,
    @Body() data: CreateRefundRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.createRefundRequest(
      ctx.user,
      vendorCustomerId,
      data,
    );
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Patch('refund-requests/:requestId/respond')
  async respondToRefundRequest(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() data: ProcessRefundRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.processRefundRequest(
      ctx.user.id,
      requestId,
      data,
    );
  }

  @Roles(UserType.User)
  @UseGuards(RolesGuard)
  @Post(':subscriptionId/cancel')
  async cancelSubscription(
    @Param('subscriptionId', ParseIntPipe) subscriptionId: number,
    @Query('vendorCustomerId', ParseIntPipe) vendorCustomerId: number,
    @Query('refund') refund: boolean,
  ) {
    return await this.subscriptionsService.cancelSubscription(
      vendorCustomerId,
      subscriptionId,
      refund,
    );
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Get('refund-requests')
  async getRefundRequests(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetRefundRequestsQueryDto,
  ) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.getRefundRequests(
      ctx.user.id,
      query,
    );
  }
}
