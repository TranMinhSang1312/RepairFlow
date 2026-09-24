import { Module } from "@nestjs/common";

import { OBJECT_STORAGE } from "../../infra/object-storage/object-storage.port.js";
import { S3ObjectStorageService } from "../../infra/object-storage/s3-object-storage.service.js";
import { MediaController, OrderMediaController } from "./media.controller.js";
import { MediaRepository } from "./media.repository.js";
import { MediaService } from "./media.service.js";
import { MediaUploadVerifier } from "./media-upload-verifier.service.js";

@Module({
  controllers: [MediaController, OrderMediaController],
  providers: [
    MediaRepository,
    MediaService,
    MediaUploadVerifier,
    { provide: OBJECT_STORAGE, useClass: S3ObjectStorageService },
  ],
  exports: [MediaUploadVerifier, OBJECT_STORAGE],
})
export class MediaModule {}
