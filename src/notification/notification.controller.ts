import { Body, Controller, Delete, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AccessGuard,
  AuthenticatedRequest,
  BaseController,
  JwtAuthGuard,
} from '@Common';
import { NotificationService } from './notification.service';
import {
  RegisterTokenDto,
  SendTestNotificationDto,
} from './dto/notification.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('notifications')
export class NotificationController extends BaseController {
  constructor(private readonly notificationService: NotificationService) {
    super();
  }

  @Post('tokens')
  async registerToken(
    @Req() req: AuthenticatedRequest,
    @Body() data: RegisterTokenDto,
  ) {
    const ctx = this.getContext(req);
    const result = await this.notificationService.registerToken(
      ctx.user.id,
      data,
    );
    return {
      success: true,
      data: result,
    };
  }

  @Delete('tokens')
  async unregisterToken(@Body('token') token: string) {
    await this.notificationService.unregisterToken(token);
    return {
      success: true,
    };
  }

  @Post('test')
  async sendTestNotification(
    @Req() req: AuthenticatedRequest,
    @Body() data: SendTestNotificationDto,
  ) {
    const ctx = this.getContext(req);
    const userId = data.userId ? Number(data.userId) : ctx.user.id;
    const result = await this.notificationService.sendNotificationToUser(
      userId,
      data.title,
      data.body,
      { isTest: 'true' },
      ctx.user.id,
    );
    return {
      success: true,
      result,
    };
  }
}
