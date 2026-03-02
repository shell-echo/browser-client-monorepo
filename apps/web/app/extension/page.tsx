"use client";
import { Button } from "@workspace/ui/components/button";
import { UnplugIcon } from "@workspace/ui/components/icons";

import { useExtension } from "~/components/provider/extension";

export default function Page() {
  const { extension } = useExtension();

  if (!extension) {
    return (
      <div className="w-screen h-screen flex justify-center items-center gap-2">
        <Button variant="ghost" size="icon-sm">
          <UnplugIcon />
        </Button>
        <blockquote className="italic text-sm text-muted-foreground">Extension not connected.</blockquote>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex justify-center items-center">
      <div className="flex flex-col gap-2">
        <Button>
          {extension.name} v{extension.version}
        </Button>
      </div>
    </div>
  );
}
