import { Module } from "@nestjs/common";
import { MerchantBranchesController } from "./merchant-branches.controller.js";

@Module({ controllers: [MerchantBranchesController] })
export class MerchantModule {}
