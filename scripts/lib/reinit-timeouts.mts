import { positiveTimeout } from "./commands.mts"

export function reinitTimeouts(env = process.env) {
  const command = positiveTimeout(env.REINIT_COMMAND_TIMEOUT_MS, 600_000, "REINIT_COMMAND_TIMEOUT_MS")
  // Preserve an explicit global override; a browser-specific override wins.
  const browser = positiveTimeout(
    env.REINIT_BROWSER_TIMEOUT_MS,
    env.REINIT_COMMAND_TIMEOUT_MS === undefined ? 1_200_000 : command,
    "REINIT_BROWSER_TIMEOUT_MS",
  )
  return { command, browser }
}

export function timeoutForCommand(args: string[], timeouts: ReturnType<typeof reinitTimeouts>) {
  return ["test:web-admin", "test:extension"].includes(args[0]) ? timeouts.browser : timeouts.command
}
