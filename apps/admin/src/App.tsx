import { useState } from "react"
import { Badge } from "@browser-client/ui/components/badge"
import { Button } from "@browser-client/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@browser-client/ui/components/card"
import { Input } from "@browser-client/ui/components/input"
import { Label } from "@browser-client/ui/components/label"

export default function App() {
  const [name, setName] = useState("Browser Client")
  const [savedName, setSavedName] = useState(name)
  const [saved, setSaved] = useState(false)
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card"><div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5"><span className="font-semibold">browser-client<span className="text-primary">.</span></span><Badge variant="outline">Admin workspace</Badge></div></header>
      <main className="mx-auto max-w-5xl px-6 py-12">
        <p className="text-sm text-muted-foreground">工作区 / 概览</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{savedName}</h1>
        <p className="mt-3 text-muted-foreground">管理台已就绪。从这里接入你的业务与数据。</p>
        <div className="mt-10 grid gap-5 md:grid-cols-[1.5fr_1fr]">
          <Card><CardHeader><CardTitle>工作区设置</CardTitle><CardDescription>试用共享表单组件。此示例仅保存在当前页面。</CardDescription></CardHeader><CardContent>
            <form onSubmit={(event) => { event.preventDefault(); setSavedName(name.trim()); setSaved(true) }} className="space-y-5">
              <div className="space-y-2"><Label htmlFor="workspace-name">工作区名称</Label><Input id="workspace-name" required maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setSaved(false) }} /></div>
              <div className="flex items-center gap-4"><Button type="submit" disabled={!name.trim()}>保存名称</Button><span role="status" className="text-sm text-muted-foreground">{saved ? "已更新当前页面" : ""}</span></div>
            </form>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>开发入口</CardTitle><CardDescription>各应用可独立运行与构建。</CardDescription></CardHeader><CardContent className="space-y-4 text-sm">
            <div className="flex justify-between"><span>Web</span><code className="text-muted-foreground">localhost:3000</code></div>
            <div className="flex justify-between"><span>Admin</span><code className="text-muted-foreground">localhost:3001</code></div>
            <div className="flex justify-between"><span>共享组件</span><code className="text-muted-foreground">packages/ui</code></div>
          </CardContent></Card>
        </div>
      </main>
    </div>
  )
}
