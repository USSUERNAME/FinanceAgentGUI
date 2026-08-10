import assert from "node:assert/strict";
import test from "node:test";

import { shouldDisplayRuntimeError } from "../src/runtimeErrorPolicy.js";


test("extension-origin errors do not create an app runtime overlay", () => {
  const error = new Error("Failed to connect to MetaMask");
  error.stack = "Error: Failed to connect to MetaMask\n at chrome-extension://example/inpage.js:1:1";
  assert.equal(shouldDisplayRuntimeError(error), false);
  assert.equal(
    shouldDisplayRuntimeError(new Error("extension failure"), "moz-extension://example/provider.js"),
    false,
  );
});

test("real application errors still create a runtime overlay", () => {
  const error = new TypeError("Cannot read properties of undefined");
  error.stack = "TypeError: Cannot read properties of undefined\n at http://127.0.0.1:5173/src/App.jsx:1:1";
  assert.equal(shouldDisplayRuntimeError(error), true);
});
