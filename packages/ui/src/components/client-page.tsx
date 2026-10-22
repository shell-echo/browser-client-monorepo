import { cn } from "../lib/utils"
import { RepositoryLink } from "./repository-link"
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
          <RepositoryLink className="size-9 rounded-md" />
        </p>
      </main>
    </div>
  )
}
