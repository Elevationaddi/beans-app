import type { IncomingMessage } from "node:http";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  type CreateUploadRequest,
  createUploadRequestSchema,
  signedTokenQuerySchema,
  type UploadTicket,
  type UploadView,
  uuidSchema,
} from "@beans/contracts";
import { z } from "zod";
import { CurrentActor } from "../auth/current-actor.decorator.js";
import { Public } from "../auth/public.decorator.js";
import type { Actor, ApiResponse } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { FilesService } from "./files.service.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));
const tokenQuery = new ZodValidationPipe(signedTokenQuerySchema);

interface BinaryResponse extends ApiResponse {
  send(body: Buffer): void;
}

@Controller("uploads")
export class UploadsController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createUploadRequestSchema)) body: CreateUploadRequest,
  ): Promise<{ data: UploadTicket }> {
    return { data: await this.files.createMerchantDocumentUpload(actor, body) };
  }

  /** Signed link target for local development storage. The token is the authorisation. */
  @Public()
  @Put(":id/content")
  @HttpCode(200)
  async content(
    @Param(idParams) params: { id: string },
    @Query(tokenQuery) query: { token: string },
    @Req() req: IncomingMessage,
  ): Promise<{ data: UploadView }> {
    return {
      data: await this.files.receiveContent(
        params.id,
        query.token,
        req.headers["content-type"],
        req.headers["content-length"],
        req,
      ),
    };
  }

  @Post(":id/complete")
  @HttpCode(200)
  async complete(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: UploadView }> {
    return { data: await this.files.complete(actor, params.id) };
  }

  /** Signed link target for local development storage. */
  @Public()
  @Get(":id/download")
  async download(
    @Param(idParams) params: { id: string },
    @Query(tokenQuery) query: { token: string },
    @Res() res: BinaryResponse,
  ): Promise<void> {
    const file = await this.files.readForDownload(params.id, query.token);
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Disposition", "attachment");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200);
    res.send(file.bytes);
  }
}
