import { ApiProperty } from '@nestjs/swagger';
import { AppTarget, DevicePlatform, NotificationKind } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { ALL_CHANNELS, type ChannelName } from '../../../domain/notification-policy';

export class NotificationPreferenceDto {
  @ApiProperty({ enum: NotificationKind, enumName: 'NotificationKind' })
  kind!: NotificationKind;

  @ApiProperty({ enum: ALL_CHANNELS, enumName: 'NotificationChannel' })
  channel!: ChannelName;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({
    description:
      'False for in-app. The centre inside the app is the record of what happened; a timeline a user can switch off would lie by omission, and the timeline is what disputes are resolved with.',
  })
  configurable!: boolean;
}

export class SetNotificationPreferenceDto {
  @ApiProperty({ enum: NotificationKind, enumName: 'NotificationKind' })
  @IsEnum(NotificationKind)
  kind!: NotificationKind;

  @ApiProperty({ enum: ['email', 'push'], enumName: 'ConfigurableChannel' })
  @IsIn(['email', 'push'], {
    message: 'Only email and push can be turned on or off.',
  })
  channel!: 'email' | 'push';

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class RegisterDeviceDto {
  @ApiProperty({ description: 'The FCM registration token.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token!: string;

  @ApiProperty({ enum: DevicePlatform, enumName: 'DevicePlatform' })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @ApiProperty({
    enum: AppTarget,
    required: false,
    description:
      'Which install this token belongs to. The driver app is a separate binary (D4) with a separate token set — a family notification arriving on a driver’s phone would be both confusing and a disclosure.',
  })
  @IsOptional()
  @IsEnum(AppTarget)
  appTarget?: AppTarget;
}

export class DeviceTokenDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: DevicePlatform, enumName: 'DevicePlatform' })
  platform!: DevicePlatform;

  @ApiProperty({ enum: AppTarget, enumName: 'AppTarget' })
  appTarget!: AppTarget;

  @ApiProperty({ format: 'date-time' })
  lastSeenAt!: string;
}
