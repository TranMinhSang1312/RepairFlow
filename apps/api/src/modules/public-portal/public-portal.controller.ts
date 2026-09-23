/* eslint-disable @typescript-eslint/consistent-type-imports -- Nest needs runtime constructors for validation metadata. */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import { QuoteDecisionDto } from "./public-portal.dto.js";
import { PublicPortalService } from "./public-portal.service.js";

@Controller("public/v1")
export class PublicPortalController {
  constructor(private readonly service: PublicPortalService) {}

  @Get("orders/:token")
  getOrder(@Param("token") token: string, @Req() request: Request) {
    return this.service.getOrder(token, request);
  }

  @Post("quotes/:token/decision")
  @HttpCode(HttpStatus.OK)
  decide(
    @Param("token") token: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: QuoteDecisionDto,
    @Req() request: Request,
  ) {
    return this.service.decide(token, dto, idempotencyKey, request);
  }
}
