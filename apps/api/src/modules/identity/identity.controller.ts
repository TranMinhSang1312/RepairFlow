/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for DI and validation metadata. */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Get,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { AccessTokenGuard } from "../../common/auth/access-token.guard.js";
import type { AuthenticatedRequest } from "../../common/auth/auth.types.js";
import { RefreshCookieService } from "../../common/auth/refresh-cookie.service.js";
import { IdentityService } from "./identity.service.js";
import { LoginDto, RegisterOwnerDto } from "./identity.dto.js";

@Controller()
export class IdentityController {
  constructor(
    private readonly identityService: IdentityService,
    private readonly refreshCookieService: RefreshCookieService,
  ) {}

  @Post("auth/register-owner")
  @HttpCode(HttpStatus.CREATED)
  async registerOwner(
    @Body() dto: RegisterOwnerDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.identityService.registerOwner(dto, request);
    this.refreshCookieService.set(response, issued.refreshToken);
    return issued.response;
  }

  @Post("auth/login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.identityService.login(dto, request);
    this.refreshCookieService.set(response, issued.refreshToken);
    return issued.response;
  }

  @Post("auth/refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const issued = await this.identityService.refresh(
      this.refreshCookieService.read(request),
      request,
    );
    this.refreshCookieService.set(response, issued.refreshToken);
    return issued.response;
  }

  @Post("auth/logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AccessTokenGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.identityService.logout(
      request.auth!.userId,
      this.refreshCookieService.read(request),
    );
    this.refreshCookieService.clear(response);
  }

  @Get("me")
  @UseGuards(AccessTokenGuard)
  async me(@Req() request: AuthenticatedRequest) {
    return this.identityService.currentUser(request.auth!.userId);
  }
}
