import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { AdminGuard } from "./admin.guard.js";
import { AuthGuard } from "./auth.guard.js";
import { DevAuthController } from "./dev-auth.controller.js";
import { DevIssuer } from "./dev-issuer.js";
import { JWKS, jwksFromEnv, TokenVerifier } from "./token-verifier.js";
import { UsersService } from "./users.service.js";

@Global()
@Module({
  controllers: [DevAuthController],
  providers: [
    DevIssuer,
    { provide: JWKS, useFactory: (env: Env) => jwksFromEnv(env), inject: [ENV] },
    TokenVerifier,
    UsersService,
    AdminGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenVerifier, UsersService, AdminGuard],
})
export class AuthModule {}
