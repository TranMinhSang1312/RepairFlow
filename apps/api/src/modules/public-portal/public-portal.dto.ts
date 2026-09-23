import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { QuoteDecision } from "@prisma/client";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

const normalizeIds = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : entry))
    : value;

export class QuoteDecisionDto {
  @IsEnum(QuoteDecision)
  decision!: QuoteDecision;

  @IsOptional()
  @Transform(normalizeIds)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  approvedItemIds?: string[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  customerNote?: string | null;
}
