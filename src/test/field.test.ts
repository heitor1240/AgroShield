import { describe, it, expect, vi } from "vitest";
import { calculateField, INITIAL_CENTER, EXAMPLE_FIELD } from "@/lib/field";
import { getFieldLayerView } from "@/lib/field-layers";
import {
  analyzeField,
  makeDemoAnalysis,
  makeDemoSms2GResponse,
  sendSms2GQuery,
} from "@/services/agroShieldApi";

describe("Field selection", () => {
  it("starts in Campo Mourão at the requested coordinates", () => {
    expect(INITIAL_CENTER).toEqual([-24.045, -52.383]);
  });
  it("requires at least three polygon vertices", () => {
    expect(
      calculateField([
        [-24, -52],
        [-24.01, -52],
      ]),
    ).toBeNull();
  });
  it("calculates hectares and the vertex centroid", () => {
    const result = calculateField([
      [0, 0],
      [0, 0.01],
      [0.01, 0.01],
      [0.01, 0],
    ]);
    expect(result?.areaHectares).toBeCloseTo(123.643458, 3);
    expect(result?.centroid).toEqual({ lat: 0.005, lng: 0.005 });
  });
});
describe("Analysis contract", () => {
  const field = calculateField(EXAMPLE_FIELD);
  if (!field) throw new Error("Example field missing");
  const payload = {
    polygon: EXAMPLE_FIELD,
    ...field,
    crop: "Soja" as const,
    currentRotation: "Soja → Milho Safrinha",
  };
  it("works without a configured backend and clearly marks the demo", async () => {
    const result = await analyzeField(payload);
    expect(result.source).toBe("demo");
    expect(result.actions).toHaveLength(3);
  });
  it("posts all field inputs to /api/analyze-field", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(makeDemoAnalysis("green"))));
    const result = await analyzeField(payload, "https://example.com");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api/analyze-field",
      expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }),
    );
    expect(result.source).toBe("api");
    fetchMock.mockRestore();
  });
  it("falls back transparently when the backend is unavailable", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const result = await analyzeField(payload, "https://example.com");
    expect(result.source).toBe("demo");
    expect(result.fallbackReason).toBeTruthy();
    mock.mockRestore();
  });
  it("supports each demonstration risk level", () => {
    for (const risk of ["green", "yellow", "red"] as const) {
      expect(makeDemoAnalysis(risk).risk).toBe(risk);
      expect(makeDemoAnalysis(risk).actions).toHaveLength(3);
    }
  });
});
describe("Orbital field layers", () => {
  it("labels unavailable satellite metrics as illustrative demo values", () => {
    const analysis = makeDemoAnalysis();
    expect(getFieldLayerView(analysis, "rain-heatmap")).toMatchObject({
      buttonLabel: "Chuva hoje",
      buttonValue: "—",
      source: "Open-Meteo · leitura de hoje indisponível",
      isDemo: false,
    });
    expect(getFieldLayerView(analysis, "soil-moisture")).toMatchObject({
      buttonValue: "78%",
      isDemo: true,
    });
    expect(getFieldLayerView(analysis, "heat").source).toContain("Demonstrativo");
    expect(getFieldLayerView(analysis, "cover").source).toContain("Demonstrativo");
  });

  it("uses measurements supplied by the analysis API", () => {
    const analysis = {
      ...makeDemoAnalysis("green"),
      source: "api" as const,
      predictedRain: 42,
      pressureHpa: 1004.5,
      pressureTrend: "QUEDA_BRUSCA" as const,
      rootZoneMoisture: 73,
      canopyTempC: 32,
      groundCoverPercent: 66,
    };
    expect(getFieldLayerView(analysis, "soil-moisture")).toMatchObject({
      buttonValue: "73%",
      source: "NASA SMAP · GWETROOT",
      isDemo: false,
    });
    expect(getFieldLayerView(analysis, "rain-heatmap")).toMatchObject({
      buttonValue: "—",
      status: "Sem leitura",
    });
    expect(
      getFieldLayerView(analysis, "rain-heatmap", {
        temperatureC: 21.7,
        precipitationTodayMm: 0.4,
        time: "2026-11-15T08:45",
      }),
    ).toMatchObject({
      buttonLabel: "Chuva hoje",
      buttonValue: "0,4 mm",
      markerValue: "🌧️ Chuva hoje: 0,4 mm (estimativa)",
      source: "Open-Meteo · acumulado estimado hoje até 08:45",
      isDemo: false,
    });
    expect(getFieldLayerView(analysis, "heat").buttonValue).toBe("32°C");
    expect(getFieldLayerView(analysis, "cover").buttonValue).toBe("66%");
  });
});
describe("SMS 2G fallback", () => {
  it("simulates 2G SMS in the frontend without throwing when offline or without backend", async () => {
    const field = calculateField(EXAMPLE_FIELD);
    if (!field) throw new Error("Example field missing");
    const payload = {
      polygon: EXAMPLE_FIELD,
      ...field,
      crop: "Soja" as const,
      currentRotation: "Soja → Milho Safrinha",
    };
    const mock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const smsOffline = await sendSms2GQuery(
      "Posso plantar soja & milho?",
      payload,
      "http://localhost:3000",
      makeDemoAnalysis("green"),
    );
    expect(smsOffline.caracteres).toBeLessThanOrEqual(150);
    expect(smsOffline.resposta_sms).toContain("SIM");
    expect(smsOffline.twiml).toContain("<Response><Message>");
    mock.mockRestore();

    const smsNoUrl = makeDemoSms2GResponse("Posso pulverizar?", payload, makeDemoAnalysis("red"));
    expect(smsNoUrl.caracteres).toBeLessThanOrEqual(150);
    expect(smsNoUrl.resposta_sms).toContain("NAO");
  });
});
