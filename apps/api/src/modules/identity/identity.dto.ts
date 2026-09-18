import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class RegisterOwnerDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  shopName!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  branchName!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;
}

export class LoginDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}
