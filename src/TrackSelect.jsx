import { useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import { TRACKS, DEFAULT_TRACK_ID } from "./tracks";
import { useGameManager } from "./gameManager";
import "./TrackSelect.css";

const TrackSelect = ({
  onPick,
  onBack,
  title = "Choose Your Course",
  subtitle = "Spawn, laps and items adapt to each track",
}) => {
  const selectedTrackId = useGameManager((s) => s.selectedTrackId);

  // Warm the course cache while the player browses, so race start is instant.
  useEffect(() => {
    TRACKS.forEach((track) => {
      if (track.id !== DEFAULT_TRACK_ID) {
        useGLTF.preload(track.glb);
      }
    });
  }, []);

  return (
    <div className="track-select">
      <h1 className="track-title">{title}</h1>
      <p className="track-subtitle">{subtitle}</p>
      <div className="track-cards">
        {TRACKS.map((track) => (
          <button
            key={track.id}
            className={`track-card${selectedTrackId === track.id ? " selected" : ""}`}
            onClick={() => onPick(track.id)}
          >
            {track.image ? (
              <img
                className="track-image"
                src={track.image}
                alt={track.name}
                loading="lazy"
              />
            ) : (
              <span className="track-emoji">{track.id === "waluigi-stadium" ? "🏟️" : "🏁"}</span>
            )}
            <span className="track-name">{track.name}</span>
            <span className="track-tagline">{track.tagline}</span>
            {selectedTrackId === track.id && <span className="track-current">CURRENT</span>}
          </button>
        ))}
      </div>
      <button className="track-back" onClick={onBack}>
        ← Back
      </button>
    </div>
  );
};

export default TrackSelect;
