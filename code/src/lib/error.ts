/** 把任意抛出的东西变成可展示的字符串（IPC 错误对象 / Error / string）。 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return JSON.stringify(err);
}
