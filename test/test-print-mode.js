import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnKimiAgent, askKimi, KimiBridgeError } from "../src/index.js";

describe("spawnKimiAgent (print mode)", () => {
  it("executes a simple prompt and returns structured result", async () => {
    const result = await spawnKimiAgent({
      prompt: "What is 2+2? Reply with just the number.",
      timeout: 30_000,
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.messages.length > 0, "should have messages");
    assert.ok(result.assistantMessages.length > 0, "should have assistant messages");
    assert.ok(result.finalMessage, "should have a final message");
    assert.ok(result.finalText.includes("4"), `expected "4" in: ${result.finalText}`);
    assert.equal(result.retryable, false);
  });

  it("respects finalOnly flag", async () => {
    const result = await spawnKimiAgent({
      prompt: "Say hello",
      finalOnly: true,
      timeout: 30_000,
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.finalText.length > 0);
  });
});

describe("askKimi (convenience)", () => {
  it("returns a plain text answer", async () => {
    const answer = await askKimi("What is the capital of France? One word answer.", {
      timeout: 30_000,
    });

    assert.ok(answer.toLowerCase().includes("paris"), `expected "paris" in: ${answer}`);
  });
});

describe("error handling", () => {
  it("throws KimiBridgeError on invalid model", async () => {
    await assert.rejects(
      () =>
        spawnKimiAgent({
          prompt: "test",
          model: "nonexistent-model-xyz",
          timeout: 15_000,
        }),
      (err) => {
        assert.ok(err instanceof KimiBridgeError);
        return true;
      },
    );
  });

  it("respects AbortSignal", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);

    await assert.rejects(
      () =>
        spawnKimiAgent({
          prompt: "Write a very long essay about the history of computing",
          signal: ac.signal,
          timeout: 60_000,
        }),
      (err) => err.name === "AbortError" || err instanceof KimiBridgeError,
    );
  });
});
