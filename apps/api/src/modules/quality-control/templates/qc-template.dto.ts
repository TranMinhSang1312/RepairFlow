import { Transform, Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

const parseBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
};

export class ListQcTemplatesQueryDto {
  @IsOptional()
  @Transform(parseBoolean)
  @IsBoolean()
  includeInactive = false;
}

export class CreateQcTemplateItemDto {
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  @Matches(/\S/u, { message: "label must contain a non-whitespace character" })
  label!: string;

  @IsBoolean()
  isRequired!: boolean;

  @IsBoolean()
  allowNa!: boolean;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  sortOrder!: number;
}

export class CreateQcTemplateDto {
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @Matches(/\S/u, { message: "name must contain a non-whitespace character" })
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateQcTemplateItemDto)
  items!: CreateQcTemplateItemDto[];
}
