// Own data properties even for keys like "__proto__", which plain assignment
// would treat as the prototype.
function put(target: any, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

export function addReadableTimestamps(data: any): any {
  if (Array.isArray(data)) {
    return data.map((item) => addReadableTimestamps(item));
  }

  if (data && typeof data === "object") {
    const result: any = {};

    for (const [key, value] of Object.entries(data)) {
      put(result, key, value);

      if (
        (key === "updated" ||
          key === "completed" ||
          key === "due" ||
          key === "created") &&
        typeof value === "string"
      ) {
        put(result, `${key}_readable`, new Date(value).toLocaleString());
      } else if (value && typeof value === "object") {
        put(result, key, addReadableTimestamps(value));
      }
    }

    return result;
  }

  return data;
}
