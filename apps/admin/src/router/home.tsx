import { notice } from "@workspace/components/notice";
import { Button } from "@workspace/ui/components/button";

function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Button onClick={() => notice.toast.success("apps/admin")}>apps/admin</Button>
    </div>
  );
}

export default HomePage;
