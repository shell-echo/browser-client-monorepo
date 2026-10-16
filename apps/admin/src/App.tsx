import { lazy, Suspense } from "react"
import { Route, Routes } from "react-router"
import HomePage from "@/pages/home"
import NotFoundPage from "@/pages/not-found"

const LoginPage = lazy(() => import("@/pages/login"))
const DashboardPage = lazy(() => import("@/pages/dashboard"))

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-svh place-items-center">
          <p role="status">Loading...</p>
        </div>
      }
    >
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
