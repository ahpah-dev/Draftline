import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { m } from "motion/react";
import { enterMotion } from "./motion";

export default function RunProgress({ status }: { status: string }) {
  const [started] = useState(Date.now);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const interval = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(interval);
  }, [started]);
  return (
    <m.div className="run-progress" {...enterMotion}>
      <div className="working-status" role="status">
        <Loader2 className="spin" size={14} aria-hidden="true" />
        <span>{status}</span>
        <span className="run-elapsed" aria-hidden="true">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      </div>
      {seconds >= 20 && (
        <p className="run-patience">
          Still working. Local models and builds can take a while. You can stop
          at any time.
        </p>
      )}
    </m.div>
  );
}
