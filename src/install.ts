export type InstallChannel = "source" | "standalone" | "docker";

export interface InstallInfo {
  channel: InstallChannel;
  binaryPath: string | null;
}

export interface DetectInstallOptions {
  compiled?: boolean;
  env?: Record<string, string | undefined>;
  execPath?: string;
}

export function isCompiledBinary(): boolean {
  return typeof Bun !== "undefined" && Bun.main.startsWith("/$bunfs/");
}

export function detectInstall(options: DetectInstallOptions = {}): InstallInfo {
  if (!(options.compiled ?? isCompiledBinary())) {
    return { channel: "source", binaryPath: null };
  }
  if (options.env?.AGENT_BENCHMARKS_INSTALL_CHANNEL === "docker") {
    return { channel: "docker", binaryPath: null };
  }
  return { channel: "standalone", binaryPath: options.execPath ?? process.execPath };
}
