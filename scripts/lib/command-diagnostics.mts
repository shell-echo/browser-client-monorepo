import type { CommandResult } from "./contracts.mts"
import { stripVTControlCharacters } from "node:util"

const secretName = /token|password|passwd|secret|api[_-]?key|authorization|credential|(?:^|_)auth(?:$|_)/i

function redact(text: string, env: NodeJS.ProcessEnv) {
  let value = stripVTControlCharacters(text)
  for (const [name, secret] of Object.entries(env)) {
    if (secretName.test(name) && typeof secret === "string" && secret.length >= 4)
      value = value.replaceAll(secret, "[REDACTED]")
  }
  return value
    .replace(/\b(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[REDACTED]@")
    .replace(/\b(Bearer|Basic)\s+[a-z\d+/=_~.-]+/gi, "$1 [REDACTED]")
    .replace(
      /(["']?[\w.-]*(?:token|password|passwd|secret|api[_-]?key|authorization|credential|auth(?=["'\s:=]))[\w.-]*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}]+)/gi,
      '$1"[REDACTED]"',
    )
    .replace(/\b(?:npm_[a-z\d]{20,}|gh[pousr]_[a-z\d]{20,}|github_pat_[a-z\d_]{20,})\b/gi, "[REDACTED]")
}

function bounded(text: string, limit: number) {
  const marker = "[earlier output truncated]\n"
  return text.length <= limit ? text : marker + text.slice(-(limit - marker.length))
}

// Never attach raw captured output to the error: maintenance reports serialize
// its message. Keep the command and the diagnostic tail separately bounded.
export function commandFailure(
  command: string,
  args: string[],
  result: Partial<Pick<CommandResult, "code" | "signal">> & { output?: string },
  env: NodeJS.ProcessEnv,
) {
  const title = bounded(redact(command + " " + args.join(" ") + " failed (" + (result.signal ?? result.code) + ")", env), 1024)
  const output = bounded(redact(result.output ?? "", env), 4096)
  return new Error(title + (output ? "\nCaptured stdout:\n" + output : ""))
}
