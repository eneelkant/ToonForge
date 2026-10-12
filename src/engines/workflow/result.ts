/** Exit status for a daily workflow result. Failed workflows are nonzero. */
export function workflowProcessCode(result: { state?: string }): 0 | 1 {
  return result.state === "FAILED" ? 1 : 0;
}

/**
 * Remove credential-shaped fragments from a workflow error before it is logged
 * or printed. Ordinary failure text is left unchanged.
 */
export function publicErrorText(message: string): string {
  return message
    .replace(/ya29\.[A-Za-z0-9._~-]+/g, "[redacted]")
    .replace(/GOCSPX-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(client_secret|refresh_token|access_token|id_token)=([^\s&]+)/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}
