import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRanks, rankAt, rankBetween } from "../src/rank";

test("keys land strictly between their neighbors", () => {
  const first = rankBetween(null, null);
  const after = rankBetween(first, null);
  const before = rankBetween(null, first);
  const middle = rankBetween(first, after);
  assert.deepEqual([before, first, middle, after].toSorted(compareRanks), [before, first, middle, after]);
});

test("a thousand inserts at either end, or squeezed into one gap, stay ordered and short", () => {
  let keys = [rankBetween(null, null)];
  for (let i = 0; i < 1_000; i++) keys.push(rankBetween(keys.at(-1)!, null));
  assert.ok(keys.at(-1)!.length <= 40, `appends stay short (${keys.at(-1)!.length})`);
  for (let i = 0; i < 1_000; i++) keys.unshift(rankBetween(null, keys[0]));
  assert.ok(keys[0].length <= 40, `prepends stay short (${keys[0].length})`);
  let low = keys[500];
  const high = keys[501];
  for (let i = 0; i < 200; i++) {
    const next = rankBetween(low, high);
    assert.ok(low < next && next < high);
    low = next;
  }
  assert.deepEqual(keys.toSorted(compareRanks), keys);
  keys = [...new Set(keys)];
  assert.equal(keys.length, 2_001, "every key is unique");
});

test("placing an item by index", () => {
  const list = ["F", "V", "k"];
  assert.ok(rankAt(list, 0) < "F");
  const second = rankAt(list, 1);
  assert.ok("F" < second && second < "V");
  assert.ok(rankAt(list, 99) > "k");
});

test("bad keys and inverted neighbors are refused", () => {
  assert.throws(() => rankBetween("V", "F"), RangeError);
  assert.throws(() => rankBetween("A0", null), RangeError);
  assert.throws(() => rankBetween("a-b", null), RangeError);
});
