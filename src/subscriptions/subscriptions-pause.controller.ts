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
  CreatePauseRequestDto,
  GetPauseRequestsQueryDto,
  RespondToPauseRequestDto,
} from './dto';
import { PauseRequestStatus } from '@prisma/client';

@ApiTags('Subscriptions Pause')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('subscriptions')
export class SubscriptionsPauseController extends BaseController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {
    super();
  }

  @Roles(UserType.User, UserType.Vendor)
  @UseGuards(RolesGuard)
  @Post('pause-requests/:subscriptionId')
  async createPauseRequest(
    @Req() req: AuthenticatedRequest,
    @Param('subscriptionId', ParseIntPipe) subscriptionId: number,
    @Body() data: CreatePauseRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.createPauseRequest(
      ctx.user,
      subscriptionId,
      data,
    );
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Patch('pause-requests/:requestId/respond')
  async respondToPauseRequest(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() data: RespondToPauseRequestDto,
  ) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.processPauseRequest(
      ctx.user.id,
      requestId,
      data.status,
    );
  }

  @Roles(UserType.User, UserType.Vendor)
  @UseGuards(RolesGuard)
  @Patch(':subscriptionId/resume')
  async resumeSubscription(
    @Req() req: AuthenticatedRequest,
    @Param('subscriptionId', ParseIntPipe) subscriptionId: number,
  ) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.resumeSubscription(
      ctx.user,
      subscriptionId,
    );
  }

  @Roles(UserType.Vendor)
  @UseGuards(RolesGuard)
  @Get('pause-requests')
  async getPauseRequests(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetPauseRequestsQueryDto,
  ) {
    const ctx = this.getContext(req);
    return await this.subscriptionsService.getPauseRequests(ctx.user.id, query);
  }
}
