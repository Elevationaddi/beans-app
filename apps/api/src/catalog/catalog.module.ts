import { Module } from "@nestjs/common";
import { CategoriesController } from "./categories.controller.js";
import { ModifierGroupsController } from "./modifier-groups.controller.js";
import { ProductsController } from "./products.controller.js";

@Module({ controllers: [CategoriesController, ProductsController, ModifierGroupsController] })
export class CatalogModule {}
