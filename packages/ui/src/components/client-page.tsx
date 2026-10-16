import { cn } from "../lib/utils"
import { ThemeSwitcher } from "./theme-switcher"

export function ClientPage({ title, popup = false }: { title: string; popup?: boolean }) {
  return (
    <div className={cn("relative grid min-h-svh place-items-center px-6 py-20", popup && "min-h-[280px] w-[360px]")}>
      <div className="absolute top-4 right-4">
        <ThemeSwitcher />
      </div>
      <main className="max-w-full min-w-0 space-y-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="flex justify-center">
          <a
            href="https://github.com/shell-echo/browser-client-monorepo"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository (opens in a new tab)"
            title="shell-echo/browser-client-monorepo"
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <svg aria-hidden="true" viewBox="0 0 19 19" className="size-5" fill="currentColor">
              {/* Reuse the GitHub mark included in the official Vite template's icons.svg. */}
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M9.356 1.85C5.05 1.85 1.57 5.356 1.57 9.694a7.84 7.84 0 0 0 5.324 7.44c.387.079.528-.168.528-.376 0-.182-.013-.805-.013-1.454-2.165.467-2.616-.935-2.616-.935-.349-.91-.864-1.143-.864-1.143-.71-.48.051-.48.051-.48.787.051 1.2.805 1.2.805.695 1.194 1.817.857 2.268.649.064-.507.27-.857.49-1.052-1.728-.182-3.545-.857-3.545-3.87 0-.857.31-1.558.8-2.104-.078-.195-.349-1 .077-2.078 0 0 .657-.208 2.14.805a7.5 7.5 0 0 1 1.946-.26c.657 0 1.328.092 1.946.26 1.483-1.013 2.14-.805 2.14-.805.426 1.078.155 1.883.078 2.078.502.546.799 1.247.799 2.104 0 3.013-1.818 3.675-3.558 3.87.284.247.528.714.528 1.454 0 1.052-.012 1.896-.012 2.156 0 .208.142.455.528.377a7.84 7.84 0 0 0 5.324-7.441c.013-4.338-3.48-7.844-7.773-7.844"
              />
            </svg>
          </a>
        </p>
      </main>
    </div>
  )
}
