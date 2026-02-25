import type { ComponentProps } from "react";

import { Toaster as SonnerToaster, toast } from "@workspace/ui/components/sonner";

const Toaster = ({ richColors = true, ...props }: ComponentProps<typeof SonnerToaster>) => {
  return <SonnerToaster richColors={richColors} {...props} />;
};

const Notice = { Toaster };

type NoticeToast = typeof import("@workspace/ui/components/sonner").toast;

const notice: { toast: NoticeToast } = { toast };

export { notice };
export default Notice;
