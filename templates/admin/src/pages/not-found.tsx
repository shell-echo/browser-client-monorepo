import { Link } from "react-router"
import { buttonVariants } from "@browser-client/ui/components/button"
import { ThemeSwitcher } from "@browser-client/ui/components/theme-switcher"

export default function NotFoundPage() {
  return (
    <div className="relative grid min-h-svh place-items-center px-6">
      <div className="absolute top-4 right-4">
        <ThemeSwitcher />
      </div>
      <main className="space-y-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground">The page you requested does not exist.</p>
        <Link to="/" className={buttonVariants({ variant: "outline" })}>
          Back to home
        </Link>
      </main>
    </div>
  )
}
