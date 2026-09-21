import { Transform } from "class-transformer";
import { CompletionOutcome, RepairOrderStatus } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class TransitionRepairOrderDto {
  @IsEnum(RepairOrderStatus)
  targetStatus!: RepairOrderStatus;

  @IsOptional()
  @IsEnum(CompletionOutcome)
  completionOutcome?: CompletionOutcome | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string | null;

  @IsInt()
  @Min(0)
  expectedLockVersion!: number;
}
