import { useState } from "react"
import { Link } from "react-router"
import { AppSidebar } from "@/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@browser-client/ui/components/breadcrumb"
import { Separator } from "@browser-client/ui/components/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@browser-client/ui/components/sidebar"
import { ThemeSwitcher } from "@browser-client/ui/components/theme-switcher"
import { TooltipProvider } from "@browser-client/ui/components/tooltip"
import { readSidebarState } from "@browser-client/ui/lib/sidebar-state"

export default function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarState)
  return (
    <TooltipProvider>
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden md:block">
                    <BreadcrumbLink render={<Link to="/" />}>Overview</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Dashboard</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            <ThemeSwitcher />
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <h1 className="sr-only">Dashboard</h1>
            <div className="grid auto-rows-min gap-4 md:grid-cols-3" aria-label="Dashboard summary placeholders">
              <div className="aspect-video rounded-xl bg-muted/50" />
              <div className="aspect-video rounded-xl bg-muted/50" />
              <div className="aspect-video rounded-xl bg-muted/50" />
            </div>
            <div
              className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min"
              aria-label="Dashboard content placeholder"
            />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
