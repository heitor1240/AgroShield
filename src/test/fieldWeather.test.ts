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
          current: {
            temperature_2m: 21.7,
            relative_humidity_2m: 83,
            time: "2026-11-15T08:45",
          },
          hourly: {
            time: [
              "2026-11-14T23:00",
              "2026-11-15T00:00",
              "2026-11-15T07:00",
              "2026-11-15T08:00",
              "2026-11-15T09:00",
            ],
            precipitation: [4, 0.1, 0.2, 0.1, 20],
            temperature_2m: [20, 20, 20.2, 21.7, 23.1],
            relative_humidity_2m: [90, 91, 97, 90, 81],
          },
          daily: { time: ["2026-11-15"], temperature_2m_max: [28.1] },
        }),
      ),
    );

    await expect(getCampoMouraoWeather()).resolves.toEqual({
      temperatureC: 21.7,
      relativeHumidityPct: 83,
      maxTemperatureTodayC: 28.1,
      precipitationTodayMm: 0.4,
      time: "2026-11-15T08:45",
      hourlyForecast: [
        {
          time: "2026-11-15T00:00",
          temperatureC: 20,
          relativeHumidityPct: 91,
        },
        {
          time: "2026-11-15T07:00",
          temperatureC: 20.2,
          relativeHumidityPct: 97,
        },
        {
          time: "2026-11-15T08:00",
          temperatureC: 21.7,
          relativeHumidityPct: 90,
        },
        {
          time: "2026-11-15T09:00",
          temperatureC: 23.1,
          relativeHumidityPct: 81,
        },
      ],
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("latitude")).toBe("-24.045");
    expect(url.searchParams.get("longitude")).toBe("-52.383");
    expect(url.searchParams.get("timezone")).toBe("America/Sao_Paulo");
    expect(url.searchParams.get("current")).toContain("relative_humidity_2m");
    expect(url.searchParams.get("hourly")).toContain("temperature_2m");
    expect(url.searchParams.get("daily")).toBe("temperature_2m_max");
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
          current: {
            temperature_2m: 21.7,
            relative_humidity_2m: 83,
            time: "2026-11-15T08:45",
          },
          hourly: {
            time: ["2026-11-15T09:00"],
            precipitation: [20],
            temperature_2m: [23.1],
          },
          daily: { time: ["2026-11-15"], temperature_2m_max: [28.1] },
        }),
      ),
    );

    await expect(getCampoMouraoWeather()).rejects.toThrow("Sem leituras de precipitação para hoje");
  });

  it("queries custom field coordinates when provided", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          current: {
            temperature_2m: 29.4,
            relative_humidity_2m: 64,
            time: "2026-11-15T10:00",
          },
          hourly: {
            time: ["2026-11-15T09:00", "2026-11-15T10:00"],
            precipitation: [0.5, 1.2],
            temperature_2m: [28.0, 29.4],
          },
          daily: { time: ["2026-11-15"], temperature_2m_max: [33.0] },
        }),
      ),
    );

    const res = await getCampoMouraoWeather(-12.57, -55.73);
    expect(res.temperatureC).toBe(29.4);
    expect(res.precipitationTodayMm).toBe(1.7);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("latitude=-12.57&longitude=-55.73");
  });
});
