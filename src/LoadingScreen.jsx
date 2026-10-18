import { useProgress } from "@react-three/drei";
import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useGameManager } from "./gameManager";
import { useOnlineRaceStore } from "./onlineRaceStore";
import { publishOnlineRaceLoad } from "./onlineRaceTransport";

const COL = { R: "#e52521", B: "#6b3a12", S: "#fbb97a", Y: "#fbd000", U: "#2b4ea2" };
const TOP = [
  "...RRRRR....",
  "..RRRRRRRRR.",
  "..BBBSSBS...",
  ".BSBSSSBSSS.",
  ".BSBBSSSBSSS",
  ".BBSSSSBBBB.",
  "...SSSSSSS..",
  "..BBRBBB....",
  ".RRRURRURRR.",
  "RRRRUUUURRRR",
  "SSRUYUUYURSS",
  "SSSUUUUUUSSS",
  "SSUUUUUUUUSS",
];
const LEGS = [
  ["..UUU..UUU..", ".BBB....BBB.", "BBBB....BBBB"],
  ["...UUUUUU...", "..BBBBBBB...", "..BBB..BBB.."],
];

const ASSETS = [
  "Mario Circuit track",
  "Road surface texture",
  "Kart model",
  "Item boxes",
  "Shell and banana models",
  "Engine audio",
  "Skybox",
  "Finish line",
  "Final touches",
];

function formatAssetName(rawItem, fallback) {
  if (!rawItem || typeof rawItem !== "string") return fallback;
  const trimmed = rawItem.trim();
  if (!trimmed || trimmed === "Ready") return fallback;

  // Extract filename without path and query parameters
  const filename = trimmed.split("/").pop().split("?")[0];
  const nameWithoutExt = filename.replace(/\.[a-zA-Z0-9]+$/, "");
  if (!nameWithoutExt) return fallback;

  // Specific friendly mapping for well-known game assets
  const lower = nameWithoutExt.toLowerCase();
  if (lower.includes("mario-circuit") || lower.includes("mariocircuit")) return "Mario Circuit track";
  if (lower.includes("shroom-ridge") || lower.includes("shroomridge")) return "Shroom Ridge track";
  if (lower.includes("waluigi") || lower.includes("stadium")) return "Waluigi Stadium track";
  if (lower.includes("driver") || lower.includes("mario") || lower.includes("luigi")) return "Driver model";
  if (lower.includes("kart")) return "Kart model";
  if (lower.includes("item") || lower.includes("box")) return "Item boxes";
  if (lower.includes("shell") || lower.includes("banana")) return "Shell and banana models";
  if (lower.includes("ost") || lower.includes("music") || lower.includes("audio") || lower.includes("sound")) return "Engine audio";
  if (lower.includes("smoke") || lower.includes("noise") || lower.includes("texture")) return "Road surface texture";

  // General clean up: replace dashes and underscores, split camelCase
  const clean = nameWithoutExt
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();

  if (!clean) return fallback;

  return clean
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function getMarioShadow(frame) {
  const rows = TOP.concat(LEGS[frame]);
  const s = [];
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const c = COL[r[x]];
      if (c) s.push(`calc(var(--px)*${x}) calc(var(--px)*${y}) ${c}`);
    }
  });
  return s.join(",");
}

export const LoadingScreen = ({ onStartWithoutStalled }) => {
  const screenRef = useRef(null);
  const barRef = useRef(null);
  const { progress, item, errors } = useProgress();
  const gameStarted = useGameManager((s) => s.gameStarted);
  const isOnlineRace = useGameManager((s) => s.isOnlineRace);
  const onlinePlayers = useGameManager((s) => s.onlinePlayers);
  const onlineSelfId = useGameManager((s) => s.onlineSelfId);

  const raceGo = useOnlineRaceStore((s) => s.raceGo);
  const raceError = useOnlineRaceStore((s) => s.raceError);
  const loadProgress = useOnlineRaceStore((s) => s.loadProgress);
  const stalledIds = useOnlineRaceStore((s) => s.stalledIds);
  const isHost = useOnlineRaceStore((s) => s.isHost);

  const hasAssetError = Array.isArray(errors) && errors.length > 0;

  const [frame, setFrame] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const [visualProgress, setVisualProgress] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [countText, setCountText] = useState("");
  const [countClass, setCountClass] = useState("");
  const [isReady, setIsReady] = useState(false);
  const countdownTriggeredRef = useRef(false);

  // Smooth visual progress interpolation (~1.5s crawl minimum)
  useEffect(() => {
    let animationFrameId = null;
    let lastTime = performance.now();

    const ramp = (currentTime) => {
      const dt = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      setVisualProgress((prev) => {
        const target = Math.max(0, Math.min(100, progress || 0));
        if (prev >= 100) return 100;

        // Smooth speed: rate of 65% per second (~1.54s to reach 100%)
        const rate = 65;
        const next = prev + rate * dt;

        // Cap at target if downloading, but if target is 100 glide up to 100
        const capped = target < 100 ? Math.min(target, next) : Math.min(100, next);
        return capped;
      });

      animationFrameId = requestAnimationFrame(ramp);
    };

    animationFrameId = requestAnimationFrame(ramp);
    return () => cancelAnimationFrame(animationFrameId);
  }, [progress]);

  // Measure bar width dynamically for runner positioning
  useEffect(() => {
    const updateWidth = () => {
      if (barRef.current) {
        setBarWidth(barRef.current.clientWidth);
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    let observer = null;
    if (typeof ResizeObserver !== "undefined" && barRef.current) {
      observer = new ResizeObserver(updateWidth);
      observer.observe(barRef.current);
    }
    return () => {
      window.removeEventListener("resize", updateWidth);
      observer?.disconnect();
    };
  }, []);

  // Online load reports: throttle to 4/s until raceGo or raceError.
  // We do NOT stop when selfLoaded is true so that a dropped WebRTC packet doesn't leave the
  // host seeing us as not loaded, and we do NOT include `progress` in deps to prevent burst floods.
  useEffect(() => {
    if (!isOnlineRace || raceGo || raceError) return;

    const sendReport = () => {
      const curProgress = useProgress.getState().progress ?? 0;
      const curLoaded = Boolean(useOnlineRaceStore.getState().loadProgress[onlineSelfId]?.loaded);
      publishOnlineRaceLoad({
        progress: curProgress,
        loaded: curLoaded,
      });
    };

    sendReport();
    const timer = window.setInterval(sendReport, 250);

    return () => window.clearInterval(timer);
  }, [isOnlineRace, raceGo, raceError, onlineSelfId]);

  // Determine readiness: requires both asset download and visual ramp completion,
  // and that no asset loading errors occurred.
  useEffect(() => {
    if (isReady || hasAssetError) return;
    if (isOnlineRace) {
      if (raceGo && visualProgress >= 100) {
        setIsReady(true);
      }
    } else {
      if (progress >= 100 && visualProgress >= 100) {
        setIsReady(true);
      }
    }
  }, [isOnlineRace, raceGo, progress, visualProgress, isReady, hasAssetError]);

  // Walk cycle animation: swap frame 0/1 every 140ms while loading
  const isMoving = !isReady && !isStarting;
  useEffect(() => {
    if (!isMoving) return;
    const interval = window.setInterval(() => {
      setFrame((f) => f ^ 1);
    }, 140);
    return () => window.clearInterval(interval);
  }, [isMoving]);

  const marioShadow = useMemo(() => getMarioShadow(isMoving ? frame : 0), [isMoving, frame]);

  // Run 3-2-1-GO countdown sequence
  const startCountdownSequence = useCallback(() => {
    setIsStarting(true);
    // Hide loader 0.5s fade before the first number
    const seq = ["3", "2", "1", "GO!"];
    let idx = 0;

    const tick = () => {
      if (idx >= seq.length) {
        // Countdown finished: hand control to the race
        useGameManager.getState().setGameStarted();
        return;
      }
      const val = seq[idx++];
      setCountClass("");
      // Force repaint to re-trigger pop animation
      requestAnimationFrame(() => {
        setCountClass(`pop${val === "GO!" ? " go" : ""}`);
        setCountText(val);

        if (val === "3") useGameManager.setState({ countdown: 3 });
        else if (val === "2") useGameManager.setState({ countdown: 2 });
        else if (val === "1") useGameManager.setState({ countdown: 1 });
        else if (val === "GO!") {
          useGameManager.setState({ countdown: 0 });
          // Play start sound and background music at GO!
          const state = useGameManager.getState();
          state.gameStartSound?.play().catch(() => {});
          state.backgroundMusic?.play().catch(() => {});
        }

        setTimeout(tick, 900);
      });
    };

    setTimeout(tick, 500);
  }, []);

  // Trigger countdown when ready: wait ~700 ms, then countdown 3-2-1-GO
  useEffect(() => {
    if (!isReady || countdownTriggeredRef.current) return;
    countdownTriggeredRef.current = true;
    const timer = setTimeout(() => {
      startCountdownSequence();
    }, 700);
    return () => clearTimeout(timer);
  }, [isReady, startCountdownSequence]);

  // Display calculations
  const displayProgress = Math.max(0, Math.min(100, visualProgress));
  const runnerLeft = barWidth ? Math.max(0, Math.min(barWidth, (barWidth * displayProgress) / 100)) : 0;

  const fallbackAsset = ASSETS[Math.min(ASSETS.length - 1, Math.floor((displayProgress / 100) * ASSETS.length))];
  const formattedItem = formatAssetName(item, fallbackAsset);
  const assetLabel = (isReady || displayProgress >= 100) ? "Ready" : formattedItem;

  // Online roster rows: own row first, then others
  const orderedPlayers = useMemo(() => {
    if (!isOnlineRace) return [];
    const self = onlinePlayers.find((p) => p.id === onlineSelfId);
    const others = onlinePlayers.filter((p) => p.id !== onlineSelfId);
    return [
      ...(self ? [{ ...self, isSelf: true }] : [{ id: onlineSelfId, name: "You", isSelf: true }]),
      ...others,
    ];
  }, [isOnlineRace, onlinePlayers, onlineSelfId]);

  const allPlayersReady = isOnlineRace && (
    Boolean(raceGo) ||
    (onlinePlayers.length > 0 && onlinePlayers.every((p) => loadProgress[p.id]?.loaded))
  );

  const stalledNames = useMemo(() => {
    return stalledIds
      .map((id) => onlinePlayers.find((p) => p.id === id)?.name ?? "a player")
      .join(", ");
  }, [stalledIds, onlinePlayers]);

  if (gameStarted) {
    return null;
  }

  return (
    <div
      className="loading-screen"
      ref={screenRef}
      style={gameStarted ? { display: "none" } : undefined}
    >
      <main
        className={`stage ${isOnlineRace ? "online" : ""} ${isMoving ? "moving" : ""} ${isStarting ? "starting" : ""}`}
        id="stage"
      >
        <div className="cloud c1"></div>
        <div className="cloud c2"></div>
        <div className="cloud c3"></div>

        {raceError || hasAssetError ? (
          <div className="race-error-card" role="alert">
            <strong>{raceError ? "Race unavailable" : "Failed to load assets"}</strong>
            <p>
              {raceError
                ? raceError
                : "One or more game assets failed to load. Please check your connection and retry."}
            </p>
            <button type="button" onClick={() => window.location.reload()}>
              {raceError ? "Back to home" : "Retry"}
            </button>
          </div>
        ) : (
          <section className="loader" id="loader" aria-live="polite">
            <div className="lane">
              <div
                className="runner"
                id="runner"
                style={{ left: `${runnerLeft}px` }}
              >
                <div className="hop">
                  <div
                    className="sprite"
                    id="sprite"
                    style={{ boxShadow: marioShadow }}
                  />
                </div>
              </div>
            </div>

            <div
              className="track"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.floor(displayProgress)}
              id="bar"
              ref={barRef}
            >
              <div
                className="fill"
                id="fill"
                style={{ width: `${displayProgress}%` }}
              />
            </div>

            <div className="meta">
              <span id="asset">{assetLabel}</span>
              <b id="pct">{Math.floor(displayProgress)}%</b>
            </div>

            {isOnlineRace && (
              <div className="wait" id="wait">
                <h2 id="waitTitle">
                  {allPlayersReady ? "Everyone is ready" : "Waiting for other players"}
                </h2>
                <div id="players">
                  {orderedPlayers.map((player) => {
                    const st = loadProgress[player.id] ?? { progress: 0, loaded: false };
                    const pPct = allPlayersReady || st.loaded ? 100 : (player.isSelf ? displayProgress : (st.progress || 0));
                    const isDone = allPlayersReady || st.loaded || pPct >= 100;
                    const isStalled = stalledIds.includes(player.id);
                    return (
                      <div
                        className={`p ${isDone ? "done" : ""} ${isStalled ? "stalled" : ""}`}
                        key={player.id}
                      >
                        <span style={isStalled ? { color: "#ff8c7a" } : undefined}>
                          {player.isSelf ? `${player.name} (You)` : player.name}
                        </span>
                        <i>
                          <s style={{ width: `${pPct}%` }} />
                        </i>
                        <span>{Math.floor(pPct)}%</span>
                      </div>
                    );
                  })}
                </div>
                {isHost && stalledIds.length > 0 && !allPlayersReady && (
                  <button
                    type="button"
                    className="load-skip-stalled"
                    onClick={onStartWithoutStalled}
                  >
                    Start without {stalledNames}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        <div id="count" aria-live="assertive" className={countClass}>
          {countText}
        </div>
      </main>
    </div>
  );
};
