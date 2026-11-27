import type { INestApplication, ModuleMetadata } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { configureApp, loggerLevels } from "../src/bootstrap.js";
import type { Env } from "../src/config/env.js";

export interface TestAppOptions {
  overrides?: { provide: unknown; useValue: unknown }[];
  extraImports?: ModuleMetadata["imports"];
}

/** The real application module with selected providers replaced (key source, publisher). */
export async function createTestApp(
  env: Env,
  options: TestAppOptions = {},
): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule.forRoot(env), ...(options.extraImports ?? [])],
  });
  for (const override of options.overrides ?? []) {
    builder = builder.overrideProvider(override.provide).useValue(override.useValue);
  }
  const moduleRef = await builder.compile();
  const app = configureApp(
    moduleRef.createNestApplication({ logger: [...loggerLevels(env)] }),
    env,
  );
  await app.init();
  return app;
}
