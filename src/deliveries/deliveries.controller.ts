import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { DeliveriesService } from './deliveries.service';
import {
  GetDailyDeliveriesReportDto,
  GetDeliveriesQueryDto,
  UpdateDeliveryStatusDto,
  GetDeliveryLogsQueryDto,
} from './dto';

@ApiTags('Deliveries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('deliveries')
export class DeliveriesController extends BaseController {
  constructor(private readonly deliveriesService: DeliveriesService) {
    super();
  }

  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Get()
  async getAllDeliveries(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetDeliveriesQueryDto,
  ) {
    const ctx = this.getContext(req);
    return await this.deliveriesService.getAll(query, ctx.user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Get('daily-report')
  async getDailyDeliveriesReport(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetDailyDeliveriesReportDto,
  ) {
    const ctx = this.getContext(req);
    return await this.deliveriesService.getDailyDeliveriesReport(
      query,
      ctx.user,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Get('logs/listing')
  async getDeliveryLogs(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetDeliveryLogsQueryDto,
  ) {
    const ctx = this.getContext(req);
    return await this.deliveriesService.getLogs(query, ctx.user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Get(':id')
  async getDeliveryById(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const ctx = this.getContext(req);
    return await this.deliveriesService.getById(BigInt(id), ctx.user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Patch(':id/status')
  async updateDeliveryStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() data: UpdateDeliveryStatusDto,
  ) {
    const ctx = this.getContext(req);
    return await this.deliveriesService.updateStatus(BigInt(id), data.status, ctx.user);
  }
}
