import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class CreateCustomerDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @Matches(/\S/, { message: "name must contain a non-whitespace character" })
  name!: string;

  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(30)
  phone!: string;

  @Transform(trim)
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class ListCustomersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}
