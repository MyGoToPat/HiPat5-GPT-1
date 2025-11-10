export const isBrowser = typeof window !== "undefined";

export function sanitizeForAgent<T>(v: T): T {
  // In browser, return full data for UI rendering
  if (isBrowser) return v;

  // In agent/headless only, trim heavy payloads for logging
  try {
    if (v && typeof v === "object") {
      const copy: any = JSON.parse(JSON.stringify(v));
      if (copy?.roleData?.items && Array.isArray(copy.roleData.items)) {
        copy.roleData.itemCount = copy.roleData.items.length;
        delete copy.roleData.items;
      }
      if (copy?.tool_calls && Array.isArray(copy.tool_calls)) {
        copy.tool_calls = { count: copy.tool_calls.length };
      }
      return copy;
    }
  } catch {}
  return v;
}
