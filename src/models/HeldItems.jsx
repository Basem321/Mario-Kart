// Shared held-item visuals (2.3 #21): the SINGLE place that decides what a
// carried slot looks like. Both Kart.jsx (local) and RemoteRacers.jsx render
// this. `visualFor` (itemVisuals.js) is the routing source of truth.
//
// T4b: singles ride in the glove at handRest (static hold). T6: throws,
// receives and uses play glove + body animation from §3.2 — the press
// commits the slot instantly while a GHOST of the item stays visible in the
// glove through the throw window (animGhost), so gameplay never waits for
// the animation. Triples never enter the glove — they orbit (ItemOrbit).

import { itemConfig } from "../items/itemConfig.js";
import { blueMul, redSingleMul } from "../items/itemScale.js";
import { visualFor } from "../items/itemVisuals.js";
import { animLive } from "../items/animCurves.js";
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

// One glove branch: forwards anim timing + ghost expiry + anchor registration.
const gloved = (driver, lift, node, anim, frozenT, ghostUntil, liveAnchor, isGolden = false) => (
  <DriverSpace>
    <GloveHand
      driver={driver}
      pose="handRest"
      lift={lift}
      animName={anim?.name ?? null}
      animStart={anim?.start ?? 0}
      animDur={anim?.totalMs ?? 0}
      frozenT={frozenT}
      isGolden={isGolden}
      ghostUntil={ghostUntil}
      liveAnchor={liveAnchor}
    >
      {node}
    </GloveHand>
  </DriverSpace>
);

export function HeldItems({
  carriedItem,
  carriedBomb,
  hidden,
  driver = "mario",
  anim = null,
  ghost = null,
  frozenT = null,
  liveAnchor = false,
}) {
  if (hidden) return null;
  const now = performance.now();
  const ghostOn = (g) => g && animLive({ name: g.anim, start: g.start, totalMs: g.totalMs }, now);
  // Carried slot wins; the ghost ALSO shows for triples mid-throw (thrown
  // single in the glove alongside the remaining orbit).
  const tripleThrow = carriedItem?.variant === "triple" && ghostOn(ghost);
  const bomb = carriedBomb || (ghost?.item?.bomb && ghostOn(ghost) ? true : false);
  const item = carriedItem ?? (ghostOn(ghost) ? ghost.item : null);
  const ghostItem = tripleThrow ? ghost.item : null;
  const vis = visualFor(item ?? null);
  const L = itemConfig.hold.lift;
  const isGhost = !carriedItem && !carriedBomb && !!item;
  const ghostUntil = isGhost && ghost ? Number(ghost.start) + Number(ghost.totalMs) : 0;
  const golden = item?.type === "golden";

  return (
    <>
      {bomb && gloved(driver, L.bomb,
        <group scale={0.5}><BombModel /></group>,
        anim, frozenT, ghostUntil, liveAnchor)}
      {vis.held === "rack" && item?.type === "mushroom" && item?.variant !== "triple" &&
        gloved(driver, L.mushroom, <MushroomModel />, anim, frozenT, ghostUntil, liveAnchor)}
      {vis.held === "rack" && golden &&
        gloved(driver, L.golden, <GoldenMushroom windowUntil={item?.windowUntil} />, anim, frozenT, ghostUntil, liveAnchor, true)}
      {item?.type === "mushroom" && item?.variant === "triple" && (
        <ItemOrbit count={item?.usesLeft ?? 3} lift={itemConfig.orbit.lifts.mushroom}>
          {[0, 1, 2].map((i) => (
            <MushroomModel key={i} />
          ))}
        </ItemOrbit>
      )}
      {vis.held === "trail" && item?.type === "red" &&
        gloved(driver, L.red, <RedShellModel sizeMul={item?.fromTriple ? 1 : redSingleMul()} />, anim, frozenT, ghostUntil, liveAnchor)}
      {vis.held === "orbit" && item?.type === "red" && (
        <RedTripleOrbit count={item?.usesLeft ?? 3} />
      )}
      {vis.held === "trail" && item?.type === "blue" &&
        gloved(driver, L.blue, <BlueShellModel sizeMul={blueMul()} />, anim, frozenT, ghostUntil, liveAnchor)}
      {vis.held === "rack" && item?.type === "bullet" &&
        gloved(driver, L.bullet, <BulletModel sizeMul={BULLET_MINI_MUL} />, anim, frozenT, ghostUntil, liveAnchor)}
      {vis.held === "float" && item?.type === "blooper" &&
        gloved(driver, L.blooper, <BlooperModel />, anim, frozenT, ghostUntil, liveAnchor)}
      {/* Triple mid-throw: the thrown single rides the glove through the
          windup while the remaining orbit keeps showing. */}
      {tripleThrow && ghostItem?.type === "red" &&
        gloved(driver, L.red, <RedShellModel sizeMul={ghostItem?.fromTriple === false ? redSingleMul() : 1} />, anim, frozenT, Number(ghost.start) + Number(ghost.totalMs), liveAnchor)}
      {tripleThrow && ghostItem?.type === "mushroom" &&
        gloved(driver, L.mushroom, <MushroomModel />, anim, frozenT, Number(ghost.start) + Number(ghost.totalMs), liveAnchor)}
    </>
  );
}
