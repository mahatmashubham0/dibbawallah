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
import { MealsService } from './meals.service';
import { CreateMealPlanDto, UpdateMealPlanDto } from './dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AccessGuard,
  AuthenticatedRequest,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  UserType,
} from '@Common';

@ApiTags('Meals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Roles(UserType.Vendor)
@UseGuards(RolesGuard)
@Controller('meals')
export class MealsController {
  constructor(private readonly mealsService: MealsService) { }

  @Post()
  async createMealPlan(
    @Req() req: AuthenticatedRequest,
    @Body() data: CreateMealPlanDto,
  ) {
    return await this.mealsService.createMealPlan(req.user.id, data);
  }

  @Patch(':id')
  async updateMealPlan(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateMealPlanDto,
  ) {
    return await this.mealsService.updateMealPlan(req.user.id, id, data);
  }

  @Get('vendor')
  async getVendorPlans(@Req() req: AuthenticatedRequest) {
    return await this.mealsService.getVendorPlans(req.user.id);
  }

  @Get(':id')
  async getPlanById(@Param('id', ParseIntPipe) id: number) {
    return await this.mealsService.getPlanById(id);
  }
}
