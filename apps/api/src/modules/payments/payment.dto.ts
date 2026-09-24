import { Transform } from "class-transformer";
import { PaymentMethod } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class CreatePaymentDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string | null;
}
