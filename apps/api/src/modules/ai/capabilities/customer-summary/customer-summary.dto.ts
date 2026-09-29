import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";

import { CUSTOMER_SUMMARY_TONES, type CustomerSummaryTone } from "@repairflow/contracts";

export class CreateCustomerSummaryDto {
  @IsUUID("4")
  repairOrderId!: string;

  @IsOptional()
  @IsUUID("4")
  diagnosisId?: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  workLogIds!: string[];

  @IsIn(CUSTOMER_SUMMARY_TONES)
  tone!: CustomerSummaryTone;

  @IsInt()
  @Min(100)
  @Max(800)
  maxCharacters!: number;
}
