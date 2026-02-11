"use client";
import { Button } from "@workspace/ui/components/button";

import { useExtension } from "~/components/provider/extension";

export default function Home() {
  const { extension } = useExtension();

  return (
    <div className="w-screen h-screen flex justify-center items-center">
      <div className="flex flex-col gap-2">
        <Button>apps/web</Button>
        {extension && (
          <Button>
            {extension.name} v{extension.version}
          </Button>
        )}
      </div>
    </div>
  );
}
