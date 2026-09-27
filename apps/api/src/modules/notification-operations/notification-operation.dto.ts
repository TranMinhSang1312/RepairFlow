import { NotificationChannel, OutboxStatus } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class ListNotificationOperationsQueryDto {
  @IsOptional()
  @IsIn([OutboxStatus.FAILED, OutboxStatus.DEAD_LETTER])
  status?: OutboxStatus;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{0,99}$/u)
  eventType?: string;

  @IsOptional()
  @IsIn(Object.values(NotificationChannel))
  channel?: NotificationChannel;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
}

export class RetryNotificationOperationDto {
  @IsInt()
  @Min(0)
  expectedLockVersion!: number;
}
