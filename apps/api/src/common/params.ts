import { uuidSchema } from "@beans/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe.js";

/** `:id` route parameter that must be a UUID. */
export const idParams = new ZodValidationPipe(z.strictObject({ id: uuidSchema }));
