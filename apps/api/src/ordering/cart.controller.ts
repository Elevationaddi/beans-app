import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  type AddCartItemRequest,
  addCartItemRequestSchema,
  type Cart,
  cartItemParamsSchema,
  deleteCartItemQuerySchema,
  type PutCartRequest,
  putCartRequestSchema,
  type UpdateCartItemRequest,
  updateCartItemRequestSchema,
} from "@beans/contracts";
import { CurrentActor } from "../auth/current-actor.decorator.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { CartService } from "./cart.service.js";

const itemParams = new ZodValidationPipe(cartItemParamsSchema);

/** The signed-in customer's cart. Prices shown are estimates; the quote is authoritative. */
@Controller("cart")
export class CartController {
  constructor(@Inject(CartService) private readonly carts: CartService) {}

  @Get()
  async get(@CurrentActor() actor: Actor): Promise<{ data: Cart | null }> {
    const cart = await this.carts.activeCart(actor.userId);
    return { data: cart ? await this.carts.view(cart) : null };
  }

  @Put()
  async put(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(putCartRequestSchema)) body: PutCartRequest,
  ): Promise<{ data: Cart }> {
    return { data: await this.carts.view(await this.carts.put(actor.userId, body)) };
  }

  @Post("items")
  async add(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(addCartItemRequestSchema)) body: AddCartItemRequest,
  ): Promise<{ data: Cart }> {
    return { data: await this.carts.view(await this.carts.addItem(actor.userId, body)) };
  }

  @Patch("items/:id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(itemParams) params: { id: string },
    @Body(new ZodValidationPipe(updateCartItemRequestSchema)) body: UpdateCartItemRequest,
  ): Promise<{ data: Cart }> {
    return {
      data: await this.carts.view(await this.carts.updateItem(actor.userId, params.id, body)),
    };
  }

  @Delete("items/:id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(itemParams) params: { id: string },
    @Query(new ZodValidationPipe(deleteCartItemQuerySchema)) query: { expectedVersion: number },
  ): Promise<{ data: Cart }> {
    return {
      data: await this.carts.view(
        await this.carts.removeItem(actor.userId, params.id, query.expectedVersion),
      ),
    };
  }
}
