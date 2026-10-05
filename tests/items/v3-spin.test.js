import { test } from "node:test";
import assert from "node:assert/strict";
import { hitApplies } from "../../src/items/homing.js";

test("hits apply only outside invulnerability", () => {
  assert.equal(hitApplies({ invulnUntil: 0 }, 1000), true);
  assert.equal(hitApplies({ invulnUntil: 500 }, 1000), true);
  assert.equal(hitApplies({ invulnUntil: 5000 }, 1000), false);
  assert.equal(hitApplies({ invulnUntil: 1000 }, 1000), true);
  assert.equal(hitApplies(null, 1000), true);
});
