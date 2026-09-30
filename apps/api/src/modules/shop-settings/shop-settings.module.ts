import { Module } from "@nestjs/common";

import { ShopSettingsController } from "./shop-settings.controller.js";
import { ShopSettingsService } from "./shop-settings.service.js";

@Module({ controllers: [ShopSettingsController], providers: [ShopSettingsService] })
export class ShopSettingsModule {}
