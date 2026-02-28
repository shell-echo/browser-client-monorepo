"use client";
import { notice } from "@workspace/components/notice";
import { Button } from "@workspace/ui/components/button";
import { useRouter } from "next/navigation";

import { useExtension } from "~/components/provider/extension";

export default function Page() {
  const router = useRouter();
  const { extension } = useExtension();

  return (
    <div className="w-screen h-screen flex justify-center items-center">
      <div className="flex flex-col gap-2">
        <Button onClick={() => notice.toast.success("apps/web")}>apps/web</Button>
        {extension && <Button onClick={() => router.push("/extension")}>extension/components</Button>}
      </div>
    </div>
  );
}
