// Runtime Zod schemas
export * from "./generated/api";
// TS-only type re-exports — `export type *` keeps the type shapes available to
// callers without colliding with the same-named Zod runtime constants above.
export type * from "./generated/types";
// A handful of *Body names are defined in BOTH ./generated/api (as Zod
// const schemas) and ./generated/types (as TS interfaces), which makes the two
// star-exports above ambiguous. Explicitly re-export the runtime Zod schema as
// the winner — its inferred type still satisfies type-only callers.
export {
  UpdateLeadBody,
  UpdateCompanyBody,
  ScanUrlBody,
  CreateLeadBody,
  CreateExecutiveBody,
} from "./generated/api";
