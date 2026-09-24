import "./CharacterSelect.css";

const DRIVERS = [
  {
    id: "mario",
    name: "Mario",
    image: "/images/mario.jpg",
    color: "#e63b3b",
  },
  {
    id: "luigi",
    name: "Luigi",
    image: "/images/luigi.jpg",
    color: "#35b558",
  },
];

const CharacterSelect = ({ mode, onPick, onBack }) => {
  const modeLabel = mode === "trial" ? "Time Trial" : mode === "online" ? "Online Lobby" : "Race";

  return (
    <div className="char-select">
      <h1 className="char-title">Choose Your Driver</h1>
      <p className="char-subtitle">
        {modeLabel} — who is driving?
      </p>
      <div className="char-cards">
        {DRIVERS.map((d) => (
          <button
            key={d.id}
            className="char-card"
            style={{ "--driver-color": d.color }}
            onClick={() => onPick(d.id)}
          >
            <img src={d.image} alt={d.name} className="char-img" />
            <span className="char-name">{d.name}</span>
          </button>
        ))}
      </div>
      <button className="char-back" onClick={onBack}>
        ← Back
      </button>
    </div>
  );
};

export default CharacterSelect;
