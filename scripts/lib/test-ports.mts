import { createServer } from "node:net"
import { readFile } from "node:fs/promises"
import { stripVTControlCharacters } from "node:util"

export async function assertTestPortAvailable(port: number) {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject)
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, resolve)
  })
  await new Promise<void>((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())))
}
export async function serverLogReady(file: string) {
  try {
    return /[Rr]eady in|Local:/.test(stripVTControlCharacters(await readFile(file, "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}
