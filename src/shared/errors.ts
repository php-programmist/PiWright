/** Текст ошибки для UI. AggregateError (multi-address connect Node) имеет пустой message —
 *  реальный смысл только в errors[]; пустой итог заменяем на String(err). */
export function errorMessage(err: unknown): string {
  if (err instanceof AggregateError) {
    const inner = [...new Set((err.errors ?? []).map((item) => (item instanceof Error ? item.message : String(item))).filter((m) => m.length > 0))]
    if (inner.length > 0) return inner.join('; ')
  }
  if (err instanceof Error && err.message.length > 0) return err.message
  return String(err)
}
