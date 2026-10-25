import { Link } from "react-router"
import { buttonVariants } from "@browser-client/ui/components/button"
import { ClientPage } from "@browser-client/ui/components/client-page"

export default function HomePage() {
  return (
    <>
      <ClientPage title="Overview" />
      <nav aria-label="Admin templates" className="fixed inset-x-0 bottom-6 flex justify-center gap-3">
        <Link to="/login" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Login template
        </Link>
        <Link to="/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Dashboard template
        </Link>
      </nav>
    </>
  )
}
