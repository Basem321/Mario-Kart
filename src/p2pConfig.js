// Central PeerJS / WebRTC configuration.
// STUN covers same-NAT cases; the free Open Relay TURN covers symmetric NATs
// and cross-network play. Replace with your own TURN credentials in prod.
export const MAX_LOBBY_PLAYERS = 10;

export const PEER_CONFIG = {
  debug: 0,
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
      // Free public TURN for cross-network lobbies (Open Relay Project).
      // For production, provision your own coturn / Twilio / Cloudflare TURN
      // and inject via VITE_TURN_URLS / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL.
      {
        urls:
          import.meta.env.VITE_TURN_URLS ??
          "turn:openrelay.metered.ca:80",
        username:
          import.meta.env.VITE_TURN_USERNAME ??
          "openrelayproject",
        credential:
          import.meta.env.VITE_TURN_CREDENTIAL ??
          "openrelayproject",
      },
    ],
    iceCandidatePoolSize: 4,
  },
};

// Simple per-sender token-bucket used by the host to bound hostile floods.
// Returns true when the event should be dropped.
const buckets = new Map();
export const shouldDropFlood = (playerId, kind, limitPerSec = 8) => {
  const now = performance.now();
  const key = `${playerId}:${kind}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }
  if (now - bucket.windowStart > 1000) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  if (buckets.size > 256) buckets.clear();
  return bucket.count > limitPerSec;
};
