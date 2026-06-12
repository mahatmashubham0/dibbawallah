import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MealsService } from './meals.service';
import {
  CreateMealDto,
  UpdateMealDto,
  CreateMealPlanDto,
  UpdateMealPlanDto,
  GetAllPlansRequestDto,
  GetAllMealsRequestDto,
} from './dto';
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
@Roles(UserType.Vendor)
@UseGuards(JwtAuthGuard, AccessGuard, RolesGuard)
@Controller('meals')
export class MealsController {
  constructor(private readonly mealsService: MealsService) { }

  // --- Base Meals ---
  @Post('base')
  async createMeal(
    @Req() req: AuthenticatedRequest,
    @Body() data: CreateMealDto,
  ) {
    return await this.mealsService.createMeal(req.user.id, data);
  }

  @Patch('base/:id')
  async updateMeal(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateMealDto,
  ) {
    await this.mealsService.updateMeal(req.user.id, id, data);
    return { status: "success" };
  }

  @Get('base/:id')
  async getMealById(
    @Param('id', ParseIntPipe) id: number
  ) {
    return await this.mealsService.getMealById(id);
  }

  @Get('base')
  async getVendorMeals(@Req() req: AuthenticatedRequest, @Query() query: GetAllMealsRequestDto) {
    return await this.mealsService.getVendorMeals(req.user.id, {
      search: query.search,
      skip: query.skip,
      take: query.take,
    });
  }

  @Delete('base/:mealId')
  async deleteMeal(
    @Req() req: AuthenticatedRequest,
    @Param('mealId', ParseIntPipe) mealId: number,
  ) {
    return this.mealsService.deleteMeal(req.user.id, mealId);
  }

  // --- Meal Plans ---
  @Post('plans')
  async createMealPlan(
    @Req() req: AuthenticatedRequest,
    @Body() data: CreateMealPlanDto,
  ) {
    await this.mealsService.createMealPlan(req.user.id, data);
    return { status: "success" };
  }

  @Patch('plans/:id')
  async updateMealPlan(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateMealPlanDto,
  ) {
    await this.mealsService.updateMealPlan(req.user.id, id, data);
    return { status: "success" };
  }

  @Get('plans')
  async getVendorPlans(@Req() req: AuthenticatedRequest, @Query() query: GetAllPlansRequestDto) {
    return await this.mealsService.getVendorPlans(req.user.id , {
      search: query.search,
      skip: query.skip,
      take: query.take,
    });
  }

  @Get('plans/:id')
  async getPlanById(@Param('id', ParseIntPipe) id: number) {
    return await this.mealsService.getPlanById(id);
  }

  @Delete('plans/:id')
  async deleteMealPlan(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return await this.mealsService.deleteMealPlan(
      req.user.id,
      id,
    );
  }
}
