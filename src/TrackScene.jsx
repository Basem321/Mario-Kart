import { PlayerController } from "./PlayerController";
import { Grid } from "@react-three/drei";
import Flames from "./particles/drift/flames/Flames";
import { Track } from "./models/Track";
import { TrackWalls } from "./TrackWalls";
import { ItemBoxes } from "./ItemBoxes";
import { BVHEnsure } from "./BVHEnsure";
import { FinishLine } from "./FinishLine";
import { RemoteRacers } from "./RemoteRacers";
import { BoostPads } from "./BoostPads";

export const TrackScene = () => {
  return (
    <>
      <PlayerController />
      <RemoteRacers />
      <Track />
      <TrackWalls />
      <BoostPads />
      <ItemBoxes />
      <BVHEnsure />
      <FinishLine />

      <Flames />

      {/* <Grid position={[0, -1.99, 0]} infiniteGrid/> */}
    </>
  );
};
