// oxlint-disable-next-line typescript/no-restricted-types -- catchが投げる値は任意の型を取り得る。
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
