// Shared held-item visuals (2.3 #21): the SINGLE place that decides what a
// carried slot looks like. Both Kart.jsx (local) and RemoteRacers.jsx render
// this. `visualFor` (itemVisuals.js) is the routing source of truth.
//
// T4b: singles ride in the glove at handRest (static hold; throw/receive
// animation is T6). Triples never enter the glove — they orbit (ItemOrbit).

import { itemConfig } from "../items/itemConfig.js";
import { visualFor } from "../items/itemVisuals.js";
import {
  BombModel,
  MushroomModel,
  RedShellModel,
  BlueShellModel,
  BulletModel,
  BlooperModel,
  RedTripleOrbit,
  GoldenMushroom,
  ItemOrbit,
} from "./Pickups.jsx";
import { DriverSpace, GloveHand } from "./GloveHand.jsx";

const BULLET_MINI_MUL =
  itemConfig.sizes.bulletHeldLength / itemConfig.sizes.bulletActiveLength;

export function HeldItems({ carriedItem, carriedBomb, hidden, driver = "mario" }) {
  if (hidden) return null;
  const vis = visualFor(carriedItem ?? null);
  const item = carriedItem;
  const L = itemConfig.hold.lift;

  return (
    <>
      {carriedBomb && (
        <DriverSpace>
          <GloveHand driver={driver} pose="handRest" lift={L.bomb}>
            <group scale={0.5}>
              <BombModel />
            </group>
          </GloveHand>
        </DriverSpace>
      )}
      {vis.held === "rack" && item?.type === "mushroom" && item?.variant !== "triple" && (
        <DriverSpace>
          <GloveHand driver={driver} pose="handRest" lift={L.mushroom}>
            <MushroomModel />
          </GloveHand>
        </DriverSpace>
      )}
      {vis.held === "rack" && item?.type === "golden" && (
        <DriverSpace>
          <GloveHand driver={driver} pose="handRest" lift={L.golden}>
            <GoldenMushroom windowUntil={item?.windowUntil} />
          </GloveHand>
        </DriverSpace>
      )}
      {item?.type === "mushroom" && item?.variant === "triple" && (
        <ItemOrbit count={item?.usesLeft ?? 3} lift={itemConfig.orbit.lifts.mushroom}>
          {[0, 1, 2].map((i) => (
            <MushroomModel key={i} />
          ))}
        </ItemOrbit>
      )}
      {vis.held === "trail" && item?.type === "red" && (
        <DriverSpace>
          <GloveHand driver={driver} pose="handRest" lift={L.red}>
            <RedShellModel />
          </GloveHand>
        </DriverSpace>
      )}
      {vis.held === "orbit" && item?.type === "red" && (
        <RedTripleOrbit count={item?.usesLeft ?? 3} />
      )}
      {vis.held === "trail" && item?.type === "blue" && (
        <DriverSpace>
          <GloveHand driver={driver} pose="handRest" lift={L.blue}>
            <BlueShellModel />
          </GloveHand>
        </DriverSpace>
      )}
      {vis.held === "rack" && item?.type === "bullet" && (
        <DriverSpace>
          <GloveHand driver={driver} pose="handRest" lift={L.bullet}>
            <BulletModel sizeMul={BULLET_MINI_MUL} />
          </GloveHand>
        </DriverSpace>
      )}
      {vis.held === "float" && item?.type === "blooper" && (
        <DriverSpace>
          <GloveHand driver={driver} pose="handRest" lift={L.blooper}>
            <BlooperModel />
          </GloveHand>
        </DriverSpace>
      )}
    </>
  );
}
