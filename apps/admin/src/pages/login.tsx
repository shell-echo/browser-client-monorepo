import { LoginForm } from "@/components/login-form"
import { ThemeSwitcher } from "@browser-client/ui/components/theme-switcher"

export default function LoginPage() {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 py-20 md:p-10 md:py-20">
      <div className="absolute top-4 right-4">
        <ThemeSwitcher />
      </div>
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </main>
  )
}
