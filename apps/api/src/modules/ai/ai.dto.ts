import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { AiCapability, AiReviewOutcome } from "@prisma/client";

const MICRO_USD_PATTERN = /^(?:0|[1-9]\d{0,17})$/u;

export class UpdateAiCapabilitySettingDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @Matches(MICRO_USD_PATTERN)
  monthlyBudgetMicrousd!: string;

  @IsString()
  @Matches(MICRO_USD_PATTERN)
  maxRunCostMicrousd!: string;

  @IsInt()
  @Min(0)
  expectedLockVersion!: number;
}

export class ReviewAiRunDto {
  @IsEnum(AiReviewOutcome)
  outcome!: AiReviewOutcome;

  @IsOptional()
  @IsObject()
  reviewedOutput?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  timeSavedSeconds?: number;
}

export class AiAnalyticsQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @IsOptional()
  @IsEnum(AiCapability)
  capability?: AiCapability;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;
}
