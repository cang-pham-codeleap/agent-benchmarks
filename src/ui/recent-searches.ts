import { normalizeRecentSearches } from "./command-palette.ts";

export function readRecentSearches(): string[] {
  try {
    const key = "agent-benchmarks-recent-searches";
    const current = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return normalizeRecentSearches(current);
  } catch {
    return [];
  }
}

export function rememberSearch(query: string): string[] {
  const values = normalizeRecentSearches(readRecentSearches(), query);
  try {
    localStorage.setItem("agent-benchmarks-recent-searches", JSON.stringify(values));
  } catch {}
  return values;
}
