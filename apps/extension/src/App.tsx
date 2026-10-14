import { useEffect, useState } from "react"
import { Badge } from "@browser-client/ui/components/badge"
import { Button } from "@browser-client/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@browser-client/ui/components/card"
import { Input } from "@browser-client/ui/components/input"
import { Label } from "@browser-client/ui/components/label"

const isExtension = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id)
const isOptions = window.location.pathname.endsWith("options.html")

export default function App() {
  const [name, setName] = useState("Browser Client")
  const [status, setStatus] = useState("")
  const [ready, setReady] = useState(!isExtension)
  useEffect(() => {
    if (!isExtension) return
    chrome.storage.local.get("workspaceName")
      .then((result) => { if (typeof result.workspaceName === "string") setName(result.workspaceName); setReady(true) })
      .catch(() => setStatus("读取设置失败，请重新打开扩展。"))
  }, [])
  async function save() {
    try {
      if (isExtension) await chrome.storage.local.set({ workspaceName: name.trim() })
      setStatus(isExtension ? "设置已保存" : "网页预览：设置仅用于演示")
    } catch {
      setStatus("保存失败，请重试。")
    }
  }
  return (
    <main className={isOptions ? "mx-auto max-w-xl p-8" : "w-[360px] p-5"}>
      <div className="mb-6 flex items-center justify-between"><span className="font-semibold">browser-client.</span><Badge variant="outline">{isExtension ? "Extension" : "Preview"}</Badge></div>
      <Card><CardHeader><CardTitle>{isOptions ? "扩展设置" : name}</CardTitle><CardDescription>{isOptions ? "设置保存在此浏览器的本地存储中。" : "你的浏览器工作区已就绪。"}</CardDescription></CardHeader><CardContent>
        {isOptions ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <div className="space-y-2"><Label htmlFor="name">工作区名称</Label><Input id="name" value={name} required maxLength={80} onChange={(event) => { setName(event.target.value); setStatus("") }} /></div>
          <Button type="submit" disabled={!ready || !name.trim()}>保存设置</Button>
        </form> : <Button className="w-full" onClick={() => {
          if (isExtension) void chrome.runtime.openOptionsPage().catch(() => setStatus("无法打开设置页"))
          else window.location.href = "./options.html"
        }}>打开设置</Button>}
        <p role="status" className="mt-3 text-sm text-muted-foreground">{status}</p>
      </CardContent></Card>
      <p className="mt-5 text-xs leading-5 text-muted-foreground">{isExtension ? "Chrome / Edge · Manifest V3" : "网页预览不包含浏览器扩展 API，请加载 dist 目录体验完整功能。"}</p>
    </main>
  )
}
