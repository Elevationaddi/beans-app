import { randomBytes } from "node:crypto";
import { Global, Logger, Module } from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { BasicFileScanner, DisabledFileScanner, FILE_SCANNER } from "./file-scanner.js";
import { FilesService } from "./files.service.js";
import { LocalObjectStorage, OBJECT_STORAGE } from "./object-storage.js";
import { FileTokenSigner } from "./signed-token.js";
import { SupabaseObjectStorage } from "./supabase-storage.js";
import { UploadsController } from "./uploads.controller.js";

function signingSecret(env: Env): string {
  if (env.FILE_SIGNING_SECRET) return env.FILE_SIGNING_SECRET;
  // Development/test only (production requires the variable): links stop working on restart.
  new Logger("FilesModule").warn("FILE_SIGNING_SECRET not set; using a random per-process secret");
  return randomBytes(32).toString("base64url");
}

@Global()
@Module({
  controllers: [UploadsController],
  providers: [
    {
      provide: OBJECT_STORAGE,
      useFactory: (env: Env) =>
        env.STORAGE_DRIVER === "supabase"
          ? // The config check guarantees both values in this mode.
            new SupabaseObjectStorage(
              env.SUPABASE_URL!,
              env.SUPABASE_SERVICE_ROLE_KEY!,
              env.SUPABASE_STORAGE_BUCKET,
            )
          : new LocalObjectStorage(
              env.STORAGE_LOCAL_DIR,
              (env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, ""),
              new FileTokenSigner(signingSecret(env)),
            ),
      inject: [ENV],
    },
    {
      provide: FILE_SCANNER,
      useFactory: (env: Env) =>
        env.FILE_SCANNER === "disabled" ? new DisabledFileScanner() : new BasicFileScanner(),
      inject: [ENV],
    },
    FilesService,
  ],
  exports: [FilesService, OBJECT_STORAGE],
})
export class FilesModule {}
