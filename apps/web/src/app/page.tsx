import Link from "next/link"
import { Badge } from "@browser-client/ui/components/badge"
import { Button } from "@browser-client/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@browser-client/ui/components/card"
import { ThemeSwitcher } from "@browser-client/ui/components/theme-switcher"

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 md:py-24">
      <div className="mb-16 flex flex-wrap items-center justify-between gap-3 border-b pb-6">
        <span className="font-semibold tracking-tight">
          browser-client<span className="text-primary">.</span>
        </span>
        <div className="flex items-center gap-3">
          <Badge variant="outline">Web workspace</Badge>
          <ThemeSwitcher />
        </div>
      </div>
      <Badge variant="secondary">一个工作区，三种入口</Badge>
      <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
        从浏览器开始，
        <br />
        构建你的下一款产品。
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
        Next.js 驱动 Web，Vite 驱动管理台与浏览器扩展。共享组件、统一主题，独立构建。
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button nativeButton={false} render={<Link href="#workspaces" />}>
          查看工作区
        </Button>
        <Button
          nativeButton={false}
          variant="outline"
          render={<a href="https://ui.shadcn.com/docs" target="_blank" rel="noreferrer" />}
        >
          shadcn/ui 文档 ↗
        </Button>
      </div>
      <section id="workspaces" className="mt-20 grid gap-4 md:grid-cols-3">
        {[
          {
            name: "Web",
            stack: "Next.js · App Router",
            command: "pnpm dev:web",
            description: "面向用户的应用入口，支持服务端渲染。",
          },
          { name: "Admin", stack: "Vite · React", command: "pnpm dev:admin", description: "独立管理台，复用同一套界面组件。" },
          {
            name: "Extension",
            stack: "Vite · Manifest V3",
            command: "pnpm dev:extension",
            description: "Chrome / Edge 扩展，与产品体验保持一致。",
          },
        ].map((item) => (
          <Card key={item.name}>
            <CardHeader>
              <CardDescription>{item.stack}</CardDescription>
              <CardTitle>{item.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="min-h-14 text-sm leading-6 text-muted-foreground">{item.description}</p>
              <code className="mt-6 block rounded-md bg-muted px-3 py-2 text-xs">{item.command}</code>
            </CardContent>
          </Card>
        ))}
      </section>
      <footer className="mt-12 text-sm text-muted-foreground">共享设计系统 · TypeScript · pnpm workspace</footer>
    </main>
  )
}
