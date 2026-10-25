import { Component, type PropsWithChildren } from "react"
import { Link } from "react-router"
import { Button, buttonVariants } from "@browser-client/ui/components/button"
import { ThemeSwitcher } from "@browser-client/ui/components/theme-switcher"

export class RouteErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div className="relative grid min-h-svh place-items-center px-6 py-20">
        <div className="absolute top-4 right-4">
          <ThemeSwitcher />
        </div>
        <main role="alert" className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Unable to load this page</h1>
          <p className="text-muted-foreground">Check your connection and refresh to try again.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button type="button" onClick={() => window.location.reload()}>
              Refresh page
            </Button>
            <Link to="/" className={buttonVariants({ variant: "outline" })}>
              Back to home
            </Link>
          </div>
        </main>
      </div>
    )
  }
}
