import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import {
  type City,
  type CreateVehicleRequest,
  createVehicleRequestSchema,
  type UpdateVehicleRequest,
  updateVehicleRequestSchema,
  uuidSchema,
  type Vehicle,
} from "@beans/contracts";
import { CurrentActor } from "../auth/current-actor.decorator.js";
import { ApiError } from "../common/api-error.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Vehicle as VehicleRow } from "../generated/prisma/client.js";

const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));

/** Most cars one customer can save (technical bound). */
export const MAX_VEHICLES = 10;

function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    plate: row.plate,
    plateRegion: row.plateRegion as City | null,
    color: row.color,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Saved cars for curbside pickup. Orders keep their own copy of the car. */
@Controller("vehicles")
export class VehiclesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentActor() actor: Actor): Promise<{ data: Vehicle[] }> {
    const rows = await this.prisma.vehicle.findMany({
      where: { userId: actor.userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return { data: rows.map(toVehicle) };
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createVehicleRequestSchema)) body: CreateVehicleRequest,
  ): Promise<{ data: Vehicle }> {
    const count = await this.prisma.vehicle.count({ where: { userId: actor.userId } });
    if (count >= MAX_VEHICLES) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        "CONFLICT",
        `You can save up to ${MAX_VEHICLES} cars. Remove one first.`,
      );
    }
    const row = await this.prisma.vehicle.create({
      data: {
        userId: actor.userId,
        plate: body.plate,
        plateRegion: body.plateRegion ?? null,
        color: body.color,
        model: body.model ?? null,
      },
    });
    return { data: toVehicle(row) };
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updateVehicleRequestSchema)) body: UpdateVehicleRequest,
  ): Promise<{ data: Vehicle }> {
    const owned = await this.prisma.vehicle.findFirst({
      where: { id: params.id, userId: actor.userId },
    });
    if (!owned) throw ApiError.notFound("Vehicle not found");
    const row = await this.prisma.vehicle.update({
      where: { id: owned.id },
      data: {
        ...(body.plate !== undefined && { plate: body.plate }),
        ...(body.plateRegion !== undefined && { plateRegion: body.plateRegion }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.model !== undefined && { model: body.model }),
      },
    });
    return { data: toVehicle(row) };
  }

  @Delete(":id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(idParams) params: { id: string },
  ): Promise<{ data: { id: string; removed: true } }> {
    const deleted = await this.prisma.vehicle.deleteMany({
      where: { id: params.id, userId: actor.userId },
    });
    if (deleted.count === 0) throw ApiError.notFound("Vehicle not found");
    return { data: { id: params.id, removed: true } };
  }
}
