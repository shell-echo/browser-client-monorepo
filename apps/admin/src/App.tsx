import { notice } from "@workspace/components/notice";
import { Button } from "@workspace/ui/components/button";

function App() {
  return (
    <div className="w-screen h-screen flex justify-center items-center">
      <Button onClick={() => notice.toast.success("apps/admin")}>apps/admin</Button>
    </div>
  );
}

export default App;
