import { afterEach, describe, expect, it, vi } from "vitest";
import { getCampoMouraoWeather } from "@/services/fieldWeather";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Campo Mourão weather", () => {
  it("loads today's temperature and accumulated precipitation from Open-Meteo", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          current: { temperature_2m: 21.7, time: "2026-11-15T08:45" },
          hourly: {
            time: [
              "2026-11-14T23:00",
              "2026-11-15T00:00",
              "2026-11-15T07:00",
              "2026-11-15T08:00",
              "2026-11-15T09:00",
            ],
            precipitation: [4, 0.1, 0.2, 0.1, 20],
          },
        }),
      ),
    );

    await expect(getCampoMouraoWeather()).resolves.toEqual({
      temperatureC: 21.7,
      precipitationTodayMm: 0.4,
      time: "2026-11-15T08:45",
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("latitude")).toBe("-24.045");
    expect(url.searchParams.get("longitude")).toBe("-52.383");
    expect(url.searchParams.get("timezone")).toBe("America/Sao_Paulo");
    expect(url.searchParams.get("hourly")).toBe("precipitation");
  });

  it("rejects malformed or out-of-range temperature data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          current: { temperature_2m: 100, time: "2026-11-15T08:45" },
          hourly: { time: [], precipitation: [] },
        }),
      ),
    );

    await expect(getCampoMouraoWeather()).rejects.toThrow("Temperatura inválida do Open-Meteo");
  });

  it("does not treat future precipitation as today's accumulation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          current: { temperature_2m: 21.7, time: "2026-11-15T08:45" },
          hourly: { time: ["2026-11-15T09:00"], precipitation: [20] },
        }),
      ),
    );

    await expect(getCampoMouraoWeather()).rejects.toThrow("Sem leituras de precipitação para hoje");
  });
});
