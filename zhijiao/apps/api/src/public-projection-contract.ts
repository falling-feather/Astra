import type { ZodType } from "zod";

export class PublicProjectionContractError extends Error {
  constructor(
    public readonly contractName: string,
    cause: unknown,
  ) {
    super(`内部公开投影不符合冻结契约：${contractName}`, { cause });
    this.name = "PublicProjectionContractError";
  }
}

export function parsePublicProjection<T>(
  schema: ZodType<T>,
  value: unknown,
  contractName: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PublicProjectionContractError(contractName, parsed.error);
  }
  return parsed.data;
}
