import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";
import "./PwaUpdateToast.css";

let updateSW = null;

// Non-blocking "new version" toast. The service worker activates the fresh
// build in the background (skipWaiting), but the page reloads ONLY when the
// player taps Refresh — so an update can never yank anyone out mid-race.
export const PwaUpdateToast = () => {
  const [needRefresh, setNeedRefresh] = useState(false);

  useEffect(() => {
    updateSW = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onRegisteredSW(swUrl, r) {
        // Long sessions: check hourly so the toast appears without a revisit.
        if (r) {
          setInterval(() => {
            r.update().catch(() => {});
          }, 60 * 60 * 1000);
        }
      },
    });
  }, []);

  if (!needRefresh) return null;

  return (
    <div className="pwa-toast" role="alert">
      <span>New version available</span>
      <button type="button" onClick={() => updateSW && updateSW(true)}>
        Refresh
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() => setNeedRefresh(false)}
      >
        Later
      </button>
    </div>
  );
};
