import { useState } from "react";
import "./LobbyScreen.css";

const DRIVERS = {
  mario: { name: "Mario", image: "/images/mario.jpg", color: "#e63b3b" },
  luigi: { name: "Luigi", image: "/images/luigi.jpg", color: "#35b558" },
};

const statusMessage = (lobby) => {
  if (lobby.status === "creating") return "Creating your P2P room…";
  if (lobby.status === "joining") return "Connecting to the lobby host…";
  if (lobby.status === "connected") {
    return lobby.isHost ? "Your lobby is live — share the code with friends." : "Connected to the host.";
  }
  return "Connection needs attention.";
};

const LobbyScreen = ({
  lobby,
  onCreateLobby,
  onRequestJoin,
  onChooseDriver,
  onStartRace,
  onLeaveLobby,
  onBack,
}) => {
  const [tab, setTab] = useState("create");
  const [hostName, setHostName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [formError, setFormError] = useState("");
  const [copyLabel, setCopyLabel] = useState("Copy code");
  const [lapCount, setLapCount] = useState(3);

  const hasLobby = lobby.status !== "idle";
  const ownDriver = lobby.self?.driver ? DRIVERS[lobby.self.driver] : null;
  const readyPlayers = lobby.players.filter((player) => Boolean(player.driver)).length;
  const canStartRace =
    lobby.isHost &&
    lobby.status === "connected" &&
    lobby.players.length >= 2 &&
    readyPlayers === lobby.players.length;

  const startHint =
    lobby.players.length < 2
      ? "Waiting for at least one friend to join."
      : readyPlayers !== lobby.players.length
        ? "Waiting for every player to choose a driver."
        : "All racers are ready. You control the start.";

  const handleCreate = (event) => {
    event.preventDefault();

    if (!hostName.trim()) {
      setFormError("Choose a display name first.");
      return;
    }

    setFormError("");
    onCreateLobby(hostName);
  };

  const handleJoin = (event) => {
    event.preventDefault();

    if (!joinName.trim() || !joinCode.trim()) {
      setFormError("Enter your name and the lobby code.");
      return;
    }

    setFormError("");
    onRequestJoin({ name: joinName, code: joinCode });
  };

  const copyLobbyCode = async () => {
    if (!lobby.lobbyCode) return;

    try {
      await navigator.clipboard.writeText(lobby.lobbyCode);
      setCopyLabel("Copied!");
    } catch {
      setCopyLabel("Copy failed");
    }

    window.setTimeout(() => setCopyLabel("Copy code"), 1600);
  };

  if (hasLobby) {
    return (
      <main className="lobby-screen">
        <div className="lobby-background lobby-background-one" />
        <div className="lobby-background lobby-background-two" />
        <section className="lobby-panel lobby-panel-active" aria-labelledby="lobby-title">
          <div className="lobby-heading">
            <div>
              <span className="lobby-kicker">{lobby.isHost ? "Online P2P host" : "Online P2P player"}</span>
              <h1 id="lobby-title">Race Lobby</h1>
              <p>{statusMessage(lobby)}</p>
            </div>
            <span className={`lobby-connection lobby-${lobby.status}`}>
              <i /> {lobby.status === "connected" ? "Live" : "Connecting"}
            </span>
          </div>

          <div className="lobby-code-card">
            <div>
              <span className="lobby-code-label">Lobby code</span>
              <strong>{lobby.lobbyCode || "------"}</strong>
              <p>Send this code to friends so they can join your room.</p>
            </div>
            <button
              type="button"
              className="lobby-copy-button"
              onClick={copyLobbyCode}
              disabled={!lobby.lobbyCode}
            >
              <span aria-hidden="true">⧉</span> {copyLabel}
            </button>
          </div>

          {lobby.error && <p className="lobby-error" role="alert">{lobby.error}</p>}

          <div className="lobby-main-grid">
            <section className="lobby-roster" aria-labelledby="players-title">
              <div className="lobby-section-heading">
                <div>
                  <span className="lobby-kicker">Players</span>
                  <h2 id="players-title">In the lobby ({lobby.players.length})</h2>
                </div>
                <span className="lobby-waiting">{lobby.status === "connected" ? "Ready to race" : "Waiting…"}</span>
              </div>

              <div className="lobby-player-list">
                {lobby.players.map((player) => {
                  const driver = player.driver ? DRIVERS[player.driver] : null;
                  const isYou = player.id === lobby.self?.id || player.id === "host-pending";

                  return (
                    <article className="lobby-player-card" key={player.id}>
                      {driver ? (
                        <img src={driver.image} alt={driver.name} className="lobby-player-image" />
                      ) : (
                        <div className="lobby-player-placeholder" aria-hidden="true">?</div>
                      )}
                      <div className="lobby-player-details">
                        <div>
                          <strong>{player.name}</strong>
                          {isYou && <span className="lobby-you-badge">You</span>}
                        </div>
                        <span style={{ "--driver-color": driver?.color ?? "#9fb3c8" }}>
                          {driver ? driver.name : "Choosing a driver…"}
                        </span>
                      </div>
                      <span className={`lobby-driver-dot ${driver ? "selected" : ""}`} />
                    </article>
                  );
                })}
              </div>
            </section>

            <aside className="lobby-self-card">
              <span className="lobby-kicker">Your driver</span>
              {ownDriver ? (
                <>
                  <img src={ownDriver.image} alt={ownDriver.name} className="lobby-self-image" />
                  <h2>{ownDriver.name}</h2>
                  <p>Your choice is shared with everyone in this lobby.</p>
                </>
              ) : (
                <>
                  <div className="lobby-self-placeholder" aria-hidden="true">?</div>
                  <h2>Choose a driver</h2>
                  <p>Pick Mario or Luigi to appear in the player list.</p>
                </>
              )}
              <button
                type="button"
                className="lobby-driver-button"
                onClick={onChooseDriver}
                disabled={lobby.status !== "connected"}
              >
                {ownDriver ? "Change driver" : "Choose driver"}
              </button>
            </aside>
          </div>

          <section className="lobby-race-actions" aria-label="Race controls">
            <div>
              <span className="lobby-kicker">Race control</span>
              {lobby.isHost ? (
                <>
                  <h2>Ready players: {readyPlayers}/{lobby.players.length}</h2>
                  <p>{startHint} The race will run for {lapCount} lap{lapCount === 1 ? "" : "s"}.</p>
                </>
              ) : (
                <>
                  <h2>Waiting for the host</h2>
                  <p>The host will start everyone at the same time.</p>
                </>
              )}
            </div>
            {lobby.isHost && (
              <div className="lobby-race-controls">
                <label className="lobby-lap-picker" htmlFor="lobby-lap-count">
                  <span>Laps</span>
                  <select
                    id="lobby-lap-count"
                    value={lapCount}
                    onChange={(event) => setLapCount(Number(event.target.value))}
                    disabled={lobby.status !== "connected"}
                  >
                    {[1, 2, 3, 4, 5].map((laps) => (
                      <option key={laps} value={laps}>{laps}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="lobby-start-button"
                  onClick={() => onStartRace(lapCount)}
                  disabled={!canStartRace}
                >
                  <span aria-hidden="true">🏁</span> Start Race
                </button>
              </div>
            )}
          </section>

          <button type="button" className="lobby-leave-button" onClick={onLeaveLobby}>
            ← Leave lobby
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="lobby-screen">
      <div className="lobby-background lobby-background-one" />
      <div className="lobby-background lobby-background-two" />
      <section className="lobby-panel" aria-labelledby="online-title">
        <div className="lobby-intro">
          <span className="lobby-kicker">Online P2P</span>
          <h1 id="online-title">Race with friends</h1>
          <p>Create a private room or join one with a code. Names and driver choices update live for every player.</p>
        </div>

        <div className="lobby-tabs" role="tablist" aria-label="Lobby action">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "create"}
            className={tab === "create" ? "active" : ""}
            onClick={() => {
              setTab("create");
              setFormError("");
            }}
          >
            Create lobby
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "join"}
            className={tab === "join" ? "active" : ""}
            onClick={() => {
              setTab("join");
              setFormError("");
            }}
          >
            Join lobby
          </button>
        </div>

        {tab === "create" ? (
          <form className="lobby-form" onSubmit={handleCreate}>
            <label htmlFor="host-name">Your display name</label>
            <input
              id="host-name"
              autoComplete="nickname"
              maxLength="20"
              placeholder="e.g. MarioFan"
              value={hostName}
              onChange={(event) => setHostName(event.target.value)}
            />
            <p className="lobby-form-hint">We generate a unique six-character code as soon as you create the room.</p>
            {formError && <p className="lobby-error" role="alert">{formError}</p>}
            <button type="submit" className="lobby-primary-button">Create Lobby</button>
          </form>
        ) : (
          <form className="lobby-form" onSubmit={handleJoin}>
            <label htmlFor="join-name">Your display name</label>
            <input
              id="join-name"
              autoComplete="nickname"
              maxLength="20"
              placeholder="e.g. LuigiMain"
              value={joinName}
              onChange={(event) => setJoinName(event.target.value)}
            />
            <label htmlFor="join-code">Lobby code</label>
            <input
              id="join-code"
              autoComplete="off"
              maxLength="12"
              placeholder="ABC123"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            />
            <p className="lobby-form-hint">Next, choose your driver before joining the lobby.</p>
            {formError && <p className="lobby-error" role="alert">{formError}</p>}
            <button type="submit" className="lobby-primary-button">Join Lobby</button>
          </form>
        )}

        <button type="button" className="lobby-back-button" onClick={onBack}>← Back to home</button>
      </section>
    </main>
  );
};

export default LobbyScreen;
