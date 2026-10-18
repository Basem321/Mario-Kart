let publishTransform = null;
let publishEvent = null;
let publishLoad = null;
const eventListeners = new Set();

// PlayerController lives inside the Three.js canvas while the PeerJS
// connection is created at the app root. This tiny bridge keeps the physics
// code independent from the lobby UI without putting network updates in React
// state on every frame.
export const setOnlineRaceTransport = (nextTransport) => {
  const nextTransform =
    typeof nextTransport === "function"
      ? nextTransport
      : typeof nextTransport?.publishTransform === "function"
        ? nextTransport.publishTransform
        : null;
  const nextEvent =
    typeof nextTransport?.publishEvent === "function" ? nextTransport.publishEvent : null;
  const nextLoad = typeof nextTransport?.publishLoad === "function" ? nextTransport.publishLoad : null;

  publishTransform = nextTransform;
  publishEvent = nextEvent;
  publishLoad = nextLoad;

  return () => {
    if (publishTransform === nextTransform) {
      publishTransform = null;
    }
    if (publishEvent === nextEvent) {
      publishEvent = null;
    }
    if (publishLoad === nextLoad) {
      publishLoad = null;
    }
  };
};

export const publishOnlineRaceTransform = (transform) => {
  publishTransform?.(transform);
};

// Gameplay actions are intentionally sent separately from the high-frequency
// movement stream. A bomb drop/explosion must arrive reliably even if a frame
// transform is skipped, and consumers in the canvas can subscribe without
// coupling the Three.js scene to the lobby UI.
export const publishOnlineRaceEvent = (event) => {
  publishEvent?.(event);
};

// Pre-race load-gate reports (display progress + explicit loaded flag).
// Throttle at the call site — this goes straight over the wire.
export const publishOnlineRaceLoad = (state) => {
  publishLoad?.(state);
};

export const subscribeOnlineRaceEvents = (listener) => {
  if (typeof listener !== "function") return () => {};

  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
};

export const receiveOnlineRaceEvent = (event) => {
  eventListeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      // One visual effect must never break delivery to the other listeners.
      console.warn("Unable to apply an online race event.", error);
    }
  });
};
