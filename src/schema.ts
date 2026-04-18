import zod from "zod";
import {
  createSchema,
  f,
  type InferSchema,
  type InferRoot,
} from "@testbu/kyju/src/v2/index.ts";

export const schema = createSchema({
  recentSessionIds: f.array(zod.string()).default([]),
});

export type SchemaRoot = InferRoot<InferSchema<typeof schema>>;
