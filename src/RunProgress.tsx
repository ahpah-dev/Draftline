import { useEffect, useState } from "react";
import { m } from "motion/react";
import { enterMotion } from "./motion";
import BrandMark from "./BrandMark";

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
    <m.div className="run-progress agy-progress" {...enterMotion}>
      <div className="working-status agy-status" role="status">
        <span className="agy-pulse-icon">
          <BrandMark size={15} />
        </span>
        <span className="agy-status-text">{status}</span>
        <span className="run-elapsed" aria-hidden="true">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      </div>
      {seconds >= 18 && (
        <p className="run-patience">
          Draftline is coordinating tools and models. You can stop at any time.
        </p>
      )}
    </m.div>
  );
}
