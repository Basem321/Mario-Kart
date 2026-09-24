import { PlayerController } from "./PlayerController";
import { Grid } from "@react-three/drei";
import Flames from "./particles/drift/flames/Flames";
import {Track} from './models/Mario-circuit-test';
import { TrackWalls } from "./TrackWalls";
import { ItemBoxes } from "./ItemBoxes";
import { BVHEnsure } from "./BVHEnsure";
import { FinishLine } from "./FinishLine";
import { RemoteRacers } from "./RemoteRacers";
export const TrackScene = () => {
  return (
    <>
      <PlayerController />
      <RemoteRacers />
      <Track />
      <TrackWalls />
      <ItemBoxes />
      <BVHEnsure />
      <FinishLine />


      <Flames />

      {/* <Grid position={[0, -1.99, 0]} infiniteGrid/> */}
    </>
  );
};
