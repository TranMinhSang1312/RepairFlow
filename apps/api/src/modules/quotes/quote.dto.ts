import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { QuoteItemKind } from "@prisma/client";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

const normalizeUuid = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export enum QuoteSendChannel {
  EMAIL = "EMAIL",
  ZALO = "ZALO",
  SMS = "SMS",
  COPY_LINK = "COPY_LINK",
}

export class SendQuoteDto {
  @IsEnum(QuoteSendChannel)
  channel!: QuoteSendChannel;
}

export class CreateQuoteItemDto {
  @IsEnum(QuoteItemKind)
  kind!: QuoteItemKind;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  @Matches(/\S/, { message: "description must contain a non-whitespace character" })
  description!: string;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999.99)
  quantity!: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  unitPrice!: number;

  @IsBoolean()
  isOptional!: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  approvalGroup?: string | null;
}

export class CreateQuoteDto {
  @IsOptional()
  @Transform(normalizeUuid)
  @IsUUID()
  diagnosisId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  discount?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(3000)
  customerNote?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  expiresAt?: string | null;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateQuoteItemDto)
  items!: CreateQuoteItemDto[];
}
