import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GOLDEN_MS,
  consumeUse,
  makeCarriedItem,
} from "../../src/items/itemWeights.js";

test("single mushroom is consumed on use", () => {
  const { item, boosted } = consumeUse({
    item: { type: "mushroom", variant: "single", usesLeft: 1 },
    now: 1000,
  });
  assert.equal(item, null);
  assert.equal(boosted, true);
});

test("triple counts down 3 to 0 then clears", () => {
  let item = { type: "mushroom", variant: "triple", usesLeft: 3 };
  for (const left of [2, 1]) {
    const r = consumeUse({ item, now: 1000 });
    assert.equal(r.boosted, true);
    assert.equal(r.item.usesLeft, left);
    item = r.item;
  }
  const last = consumeUse({ item, now: 1000 });
  assert.equal(last.boosted, true);
  assert.equal(last.item, null);
});

test("golden stays usable inside the window, expires after", () => {
  const item = { type: "golden", variant: "single", usesLeft: -1, windowUntil: 5000 + GOLDEN_MS };
  const inside = consumeUse({ item, now: 5000 });
  assert.equal(inside.boosted, true);
  assert.equal(inside.item, item);
  const after = consumeUse({ item, now: 5000 + GOLDEN_MS + 1 });
  assert.equal(after.boosted, false);
  assert.equal(after.item, null);
});

test("makeCarriedItem builds v3 slot shapes", () => {
  assert.deepEqual(makeCarriedItem("mushroom", "single"), {
    type: "mushroom",
    variant: "single",
    usesLeft: 1,
  });
  assert.deepEqual(makeCarriedItem("mushroom", "triple"), {
    type: "mushroom",
    variant: "triple",
    usesLeft: 3,
  });
});

test("makeCarriedItem golden leaves the window unopened until first use", () => {
  const golden = makeCarriedItem("golden", "single", 1000);
  assert.equal(golden.windowUntil, null);
  assert.equal(golden.usesLeft, -1);
  const first = consumeUse({ item: golden, now: 1000 });
  assert.equal(first.boosted, true);
  assert.equal(first.item.windowUntil, 1000 + GOLDEN_MS);
});
