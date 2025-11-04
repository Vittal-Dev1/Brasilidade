// src/app/lib/template.ts
export function applyTemplate<T extends Record<string, unknown>>(tpl: string, data: T): string {
  return tpl.replace(/{{\s*([\w.]+)\s*}}/g, (_match: string, key: string) => {
    const k = String(key);
    const record = data as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, k)) {
      const val = record[k];
      if (val === null || val === undefined) return "";
      return typeof val === "string" ? val : String(val);
    }
    return `{{${k}}}`;
  });
}
