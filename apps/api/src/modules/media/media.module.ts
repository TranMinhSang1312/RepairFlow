import { Module } from "@nestjs/common";
import { parseApiEnvironment } from "@repairflow/config";

import { OBJECT_STORAGE } from "../../infra/object-storage/object-storage.port.js";
import { S3ObjectStorageService } from "../../infra/object-storage/s3-object-storage.service.js";
import { MediaController, OrderMediaController } from "./media.controller.js";
import { MediaRepository } from "./media.repository.js";
import { MEDIA_UPLOAD_OPTIONS, MediaService } from "./media.service.js";
import { MediaUploadVerifier } from "./media-upload-verifier.service.js";

@Module({
  controllers: [MediaController, OrderMediaController],
  providers: [
    MediaRepository,
    MediaService,
    MediaUploadVerifier,
    { provide: OBJECT_STORAGE, useClass: S3ObjectStorageService },
    {
      provide: MEDIA_UPLOAD_OPTIONS,
      useFactory: () => {
        const environment = parseApiEnvironment(process.env);
        return {
          intakeAudioEnabled: environment.AI_INTAKE_AUDIO_ENABLED,
          transcriptionProvider: environment.AI_TRANSCRIPTION_PROVIDER,
          maxAudioBytes: environment.AI_MAX_AUDIO_BYTES,
        };
      },
    },
  ],
  exports: [MediaUploadVerifier, OBJECT_STORAGE],
})
export class MediaModule {}
