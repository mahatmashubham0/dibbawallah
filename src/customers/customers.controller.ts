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
import { CustomersService } from './customers.service';
import {
  GetCustomersQueryDto,
  UpdateCustomerDto,
  GetCustomersDueSummaryQueryDto,
  GetCustomerCalendarQueryDto,
  CustomerBillingDto,
} from './dto';

@ApiTags('Customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('customers')
export class CustomersController extends BaseController {
  constructor(private readonly customersService: CustomersService) {
    super();
  }

  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Get()
  async getAllCustomers(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetCustomersQueryDto,
  ) {
    const ctx = this.getContext(req);
    return await this.customersService.getAll(query, ctx.user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Get('analytics/due-summary')
  async getCustomersDueSummary(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetCustomersDueSummaryQueryDto,
  ) {
    const ctx = this.getContext(req);
    return await this.customersService.getDueSummary(query, ctx.user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Get(':id')
  async getCustomerById(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ctx = this.getContext(req);
    return await this.customersService.getById(id, ctx.user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Get(':id/calendar')
  async getCustomerCalendar(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetCustomerCalendarQueryDto,
  ) {
    const ctx = this.getContext(req);
    return await this.customersService.getCalendarData(id, query, ctx.user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Patch(':id')
  async updateCustomer(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateCustomerDto,
  ) {
    const ctx = this.getContext(req);
    return await this.customersService.update(id, data, ctx.user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Post(':id/billing')
  async handleCustomerBilling(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: CustomerBillingDto,
  ) {
    const ctx = this.getContext(req);
    return await this.customersService.handleBilling(id, data, ctx.user);
  }


  @UseGuards(RolesGuard)
  @Roles(UserType.Admin, UserType.Vendor)
  @Get(':id/billing-activities')
  async getCustomerBillingActivities(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: { vendorId?: number; skip?: number; take?: number },
  ) {
    const ctx = this.getContext(req);
    const skip = query.skip ? Number(query.skip) : undefined;
    const take = query.take ? Number(query.take) : undefined;
    const vendorId = query.vendorId ? Number(query.vendorId) : undefined;
    return await this.customersService.getBillingActivities(
      id,
      { vendorId, skip, take },
      ctx.user,
    );
  }
}
