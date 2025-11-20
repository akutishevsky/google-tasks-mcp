export function addReadableTimestamps(data: any): any {
  if (Array.isArray(data)) {
    return data.map((item) => addReadableTimestamps(item));
  }

  if (data && typeof data === "object") {
    const result: any = {};

    for (const [key, value] of Object.entries(data)) {
      result[key] = value;

      if (
        (key === "updated" ||
          key === "completed" ||
          key === "due" ||
          key === "created") &&
        typeof value === "string"
      ) {
        result[`${key}_readable`] = new Date(value).toLocaleString();
      } else if (value && typeof value === "object") {
        result[key] = addReadableTimestamps(value);
      }
    }

    return result;
  }

  return data;
}
