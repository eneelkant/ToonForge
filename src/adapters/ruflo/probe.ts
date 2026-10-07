import { spawn } from "node:child_process";
import type { AdapterAvailability } from "../types.js";

export async function probeRufloCli(timeoutMs = 8000): Promise<AdapterAvailability> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["-y", "ruflo@latest", "--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, npm_config_yes: "true" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ status: "unavailable", detail: "ruflo --version timed out" });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: "unavailable", detail: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ status: "ready", detail: (stdout || stderr).trim().slice(0, 200) || "ruflo ok" });
      } else {
        resolve({
          status: "unavailable",
          detail: `ruflo exited ${code}: ${(stderr || stdout).trim().slice(0, 200)}`,
        });
      }
    });
  });
}
