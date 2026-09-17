import { describe, expect, it } from "vitest";
import {
  ModelConfigurationError,
  readModelGatewayConfig,
} from "../src/index.js";

describe("model gateway configuration", () => {
  it("defaults to an offline deterministic profile", () => {
    const config = readModelGatewayConfig({});

    expect(config.provider).toBe("deterministic");
    expect(config.timeoutMs).toBe(20_000);
  });

  it("loads a DeepSeek profile without returning credentials in errors", () => {
    const config = readModelGatewayConfig({
      MODEL_PROVIDER: "deepseek",
      MODEL_PROFILE_ID: "deepseek-local",
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_MODEL: "deepseek-v4-pro",
    });

    expect(config.provider).toBe("deepseek");
    if (config.provider === "deepseek") {
      expect(config.model).toBe("deepseek-v4-pro");
      expect(config.visionModel).toBeNull();
      expect(config.baseUrl).toBe("https://api.deepseek.com/");
    }
  });

  it("fails closed when a selected live provider has no server credential", () => {
    expect(() => readModelGatewayConfig({
      MODEL_PROVIDER: "deepseek",
    })).toThrow(ModelConfigurationError);
  });
});
