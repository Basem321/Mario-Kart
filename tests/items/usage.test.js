import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GOLDEN_MS,
  consumeUse,
  makeCarriedItem,
} from "../../src/items/itemWeights.js";

test("single mushroom is consumed on use", () => {
  const { item, boosted } = consumeUse({
    item: { type: "mushroom", charges: 1, expiresAt: 0 },
    now: 1000,
  });
  assert.equal(item, null);
  assert.equal(boosted, true);
});

test("triple counts down 3 to 0 then clears", () => {
  let item = { type: "triple", charges: 3, expiresAt: 0 };
  for (const left of [2, 1]) {
    const r = consumeUse({ item, now: 1000 });
    assert.equal(r.boosted, true);
    assert.equal(r.item.charges, left);
    item = r.item;
  }
  const last = consumeUse({ item, now: 1000 });
  assert.equal(last.boosted, true);
  assert.equal(last.item, null);
});

test("golden stays usable inside the window, expires after", () => {
  const item = { type: "golden", charges: -1, expiresAt: 5000 + GOLDEN_MS };
  const inside = consumeUse({ item, now: 5000 });
  assert.equal(inside.boosted, true);
  assert.equal(inside.item, item);
  const after = consumeUse({ item, now: 5000 + GOLDEN_MS + 1 });
  assert.equal(after.boosted, false);
  assert.equal(after.item, null);
});

test("makeCarriedItem golden expiry uses the given clock", () => {
  const golden = makeCarriedItem("golden", 1000);
  assert.equal(golden.expiresAt, 1000 + GOLDEN_MS);
});
