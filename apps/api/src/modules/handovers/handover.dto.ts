import { Type, Transform } from "class-transformer";
import { PaymentDisposition } from "@prisma/client";
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

import { CreatePaymentDto } from "../payments/payment.dto.js";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class CreateWarrantyDto {
  @IsISO8601({ strict: true })
  endsAt!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  terms!: string;
}

export class CompleteHandoverDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  recipientName!: string;

  @IsEnum(PaymentDisposition)
  paymentDisposition!: PaymentDisposition;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  paymentNote?: string | null;

  @IsOptional()
  @IsUUID()
  signatureMediaAssetId?: string | null;

  @IsInt()
  @Min(0)
  expectedLockVersion!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePaymentDto)
  payment?: CreatePaymentDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateWarrantyDto)
  warranty?: CreateWarrantyDto | null;
}
