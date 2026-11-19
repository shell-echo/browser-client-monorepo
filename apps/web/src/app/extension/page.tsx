import Link from "next/link"
import { Badge } from "@browser-client/ui/components/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@browser-client/ui/components/card"
import { ThemeSwitcher } from "@browser-client/ui/components/theme-switcher"
import { ExtensionConnection } from "./connection"

const demoSteps = [
  ["01", "Ask", "The Agent requests a real viewport and only the bounded actions it needs."],
  ["02", "Approve", "You approve this exact origin in the extension Connections screen."],
  ["03", "Observe and act", "The Agent sees a Chrome screenshot, acts through the extension, then observes again."],
] as const

export default function ExtensionPage() {
  return (
    <main className="mx-auto min-h-svh max-w-5xl space-y-10 px-4 py-12 sm:px-6 lg:py-20">
      <div className="flex items-center justify-between gap-4">
        <Link className="underline underline-offset-4" href="/">
          Back to home
        </Link>
        <ThemeSwitcher />
      </div>
      <section className="max-w-3xl space-y-5" aria-labelledby="demo-title">
        <Badge variant="outline">Live Browser Agent demo · MV3 + Native Port</Badge>
        <h1 id="demo-title" className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Give an Agent a safe browser handoff.
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
          This page uses the real extension SDK. Connect your unpacked extension, approve this page, and let the same bounded
          viewport, click, scroll, and type tools that MCP, OpenAI, and LangChain adapters expose operate on this real tab.
        </p>
      </section>
      <section aria-labelledby="steps-title">
        <h2 id="steps-title" className="sr-only">
          Demo steps
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {demoSteps.map(([number, title, description]) => (
            <Card key={number} className="bg-muted/30">
              <CardHeader>
                <p className="text-xs font-medium text-muted-foreground">{number}</p>
                <CardTitle className="text-base">{title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground">{description}</CardContent>
            </Card>
          ))}
        </div>
      </section>
      <ExtensionConnection />
      <section className="border-t pt-8 text-sm leading-7 text-muted-foreground" aria-labelledby="demo-notes-title">
        <h2 id="demo-notes-title" className="font-medium text-foreground">
          What this proves
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>Consent is explicit and tied to this origin, tab, and document.</li>
          <li>Chrome returns the visible viewport and the extension executes bounded page actions.</li>
          <li>The local fixture is safe demo content; it does not replace the real extension or browser.</li>
          <li>Revocation or navigation ends the grant without replaying an ambiguous write.</li>
        </ul>
      </section>
    </main>
  )
}
