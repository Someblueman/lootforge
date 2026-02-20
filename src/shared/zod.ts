export function formatIssuePath(pathItems: Array<string | number>): string {
  if (pathItems.length === 0) {
    return "$";
  }

  return pathItems
    .map((item, index) => {
      if (typeof item === "number") {
        return `[${item}]`;
      }
      return index === 0 ? item : `.${item}`;
    })
    .join("");
}
