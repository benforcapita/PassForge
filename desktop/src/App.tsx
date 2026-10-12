import { useEffect, useState } from "react";
import { api } from "./api";
import { LockScreen } from "./views/LockScreen";
import { Workbench } from "./views/Workbench";

export function App() {
  const [locked, setLocked] = useState<boolean | null>(null);

  useEffect(() => {
    void api
      .isLocked()
      .then(setLocked)
      .catch(() => setLocked(true));
  }, []);

  if (locked === null) {
    return <div className="h-full bg-pf-canvas" />;
  }

  return locked ? (
    <LockScreen onUnlock={() => setLocked(false)} />
  ) : (
    <Workbench onLock={() => setLocked(true)} />
  );
}
