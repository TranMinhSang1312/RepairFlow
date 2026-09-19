import { Inject, Injectable } from "@nestjs/common";
import type { MediaAsset } from "@prisma/client";

import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../../infra/object-storage/object-storage.port.js";

@Injectable()
export class MediaUploadVerifier {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort) {}

  async isComplete(asset: MediaAsset, now = new Date()): Promise<boolean> {
    if (asset.repairOrderId || !asset.expiresAt || asset.expiresAt <= now) {
      return false;
    }
    const stored = await this.storage.head(asset.objectKey);
    if (!stored) {
      return false;
    }
    return (
      stored.byteSize === asset.byteSize &&
      stored.mimeType === asset.mimeType &&
      (!asset.checksumSha256 || stored.checksumSha256 === asset.checksumSha256)
    );
  }
}
