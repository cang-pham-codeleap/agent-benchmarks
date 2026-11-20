export function stripGoldenVolatility(
  value: unknown,
  agentBenchmarksVersion: string,
  key: string | null = null,
): unknown {
  if (typeof value === "string") {
    if ((key === "version" || key === "generated_with") && value === agentBenchmarksVersion) {
      return "0.0.0-dev";
    }
    if (key === "artifact") {
      return value.replaceAll(`Agent Benchmarks ${agentBenchmarksVersion}`, "Agent Benchmarks 0.0.0-dev");
    }
    if (key === "href") {
      return value.replace(/^\/sessions\/\d+(?=#message-\d+$)/, "/sessions/<ID>");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((child) => stripGoldenVolatility(child, agentBenchmarksVersion));
  }
  if (value != null && typeof value === "object") {
    const volatileKeys = new Set(["id", "session_id", "block_id"]);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([childKey]) => !volatileKeys.has(childKey))
        .map(([childKey, child]) => [
          childKey,
          stripGoldenVolatility(child, agentBenchmarksVersion, childKey),
        ]),
    );
  }
  return value;
}
