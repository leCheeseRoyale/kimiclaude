import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KimiWireSession } from "../src/index.js";

describe("KimiWireSession (wire mode)", () => {
  it("initializes and completes a prompt turn", async () => {
    const session = new KimiWireSession();
    const events = [];

    try {
      const initResult = await session.initialize();
      assert.ok(initResult, "initialize should return a result");

      session.on("event", (evt) => events.push(evt));

      const result = await session.prompt("What is 3+3? Reply with just the number.");
      assert.equal(result.status, "finished");
    } finally {
      await session.close();
    }
  });

  it("handles multiple sequential prompts", async () => {
    const session = new KimiWireSession();

    try {
      await session.initialize();

      const r1 = await session.prompt("Remember the number 42.");
      assert.equal(r1.status, "finished");

      const r2 = await session.prompt("What number did I ask you to remember?");
      assert.equal(r2.status, "finished");
    } finally {
      await session.close();
    }
  });
});
