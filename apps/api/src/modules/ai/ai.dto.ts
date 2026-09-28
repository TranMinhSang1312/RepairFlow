import { AiReviewOutcome } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

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
