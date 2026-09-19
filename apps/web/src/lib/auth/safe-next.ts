const STAFF_ROOTS = ["/orders", "/intake"] as const;

export function safeStaffNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/orders";
  if (
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    return "/orders";
  }

  let url: URL;
  try {
    url = new URL(value, "https://repairflow.local");
  } catch {
    return "/orders";
  }

  if (url.origin !== "https://repairflow.local") return "/orders";
  if (!STAFF_ROOTS.some((root) => url.pathname === root || url.pathname.startsWith(`${root}/`))) {
    return "/orders";
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
