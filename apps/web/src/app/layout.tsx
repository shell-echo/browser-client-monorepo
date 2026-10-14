import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Browser Client",
  description: "Web、管理台和浏览器扩展的共享工作区",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
