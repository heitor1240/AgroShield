import type { FieldAnalysis, Risk } from "@/services/agroShieldApi";

export type FieldMapLayer = "alert" | "rain-heatmap" | "soil-moisture" | "heat" | "cover";

export interface FieldLayerView {
  title: string;
  buttonLabel: string;
  buttonValue: string;
  markerValue: string;
  status: string;
  source: string;
  whyItMatters: string;
  color: string;
  borderColor: string;
  gradientId: string | null;
  isDemo: boolean;
  critical: boolean;
}

const riskLabels: Record<Risk, string> = {
  red: "Vermelho",
  yellow: "Amarelo",
  green: "Verde",
};

const riskColors: Record<Risk, string> = {
  red: "#DC2626",
  yellow: "#D97706",
  green: "#16A34A",
};

function boundedPercent(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value)
    : fallback;
}

export function getFieldLayerView(analysis: FieldAnalysis, layer: FieldMapLayer): FieldLayerView {
  if (layer === "alert") {
    const color = riskColors[analysis.risk];
    return {
      title: "Alerta Geral",
      buttonLabel: "Alerta",
      buttonValue: riskLabels[analysis.risk],
      markerValue: `🚨 Alerta: ${riskLabels[analysis.risk]}`,
      status: riskLabels[analysis.risk],
      source:
        analysis.source === "demo"
          ? "Cenário demonstrativo · não é observação NASA"
          : analysis.dataSources || "Resultado da API",
      whyItMatters:
        "Resume o risco atual para orientar operações e priorizar a inspeção do talhão.",
      color,
      borderColor: color,
      gradientId: null,
      isDemo: analysis.source === "demo",
      critical: analysis.risk === "red",
    };
  }

  if (layer === "rain-heatmap") {
    const isDemo = analysis.source === "demo";
    const rainMm = Math.max(0, Math.round(analysis.predictedRain));
    const pressureText =
      typeof analysis.pressureHpa === "number" ? ` · ${analysis.pressureHpa} hPa` : "";
    const rainHigh =
      rainMm >= (analysis.rainLimitMm ?? 50) || analysis.pressureTrend === "QUEDA_BRUSCA";
    const rainModerate =
      !rainHigh && (rainMm >= 20 || analysis.pressureTrend === "INSTAVEL");
    const status = rainHigh
      ? "Chuva Forte / Baixa Pressão"
      : rainModerate
        ? "Instável"
        : "Estável";
    return {
      title: "Mapa de Calor de Chuva",
      buttonLabel: "Mapa de Calor",
      buttonValue: `${rainMm} mm`,
      markerValue: `🌧️ Chuva: ${rainMm} mm${pressureText} (${status})`,
      status,
      source: isDemo
        ? "Demonstrativo · Precipitação e pressão simuladas"
        : "NASA POWER + Open-Meteo (Chuva + Pressão hPa)",
      whyItMatters:
        "O mapa de calor cruza o volume de chuva prevista com a pressão atmosférica (hPa) para antecipar frentes frias e núcleos de chuva sobre o talhão.",
      color: rainHigh ? "#1D4ED8" : rainModerate ? "#0284C7" : "#0EA5E9",
      borderColor: rainHigh ? "#1E3A8A" : rainModerate ? "#0369A1" : "#0284C7",
      gradientId: rainHigh
        ? "agroshield-rain-heat-high"
        : rainModerate
          ? "agroshield-rain-heat-mid"
          : "agroshield-rain-heat-low",
      isDemo,
      critical: rainHigh,
    };
  }

  if (layer === "soil-moisture") {
    const hasRootZone = typeof analysis.rootZoneMoisture === "number";
    const isDemo =
      analysis.source === "demo" || (!hasRootZone && analysis.soilMoisture === undefined);
    const value = boundedPercent(
      isDemo ? undefined : (analysis.rootZoneMoisture ?? analysis.soilMoisture),
      78,
    );
    const status = value >= 75 ? "Encharcado" : value >= 50 ? "Úmido" : "Seco";
    return {
      title: "Umidade do Solo",
      buttonLabel: "Umidade",
      buttonValue: `${value}%`,
      markerValue: `💧 Umidade Solo: ${value}% (${status})`,
      status,
      source: isDemo
        ? "Demonstrativo · não é observação SMAP"
        : hasRootZone
          ? "NASA SMAP · GWETROOT"
          : "API · umidade superficial",
      whyItMatters:
        "A umidade na zona radicular ajuda a avaliar risco de saturação, tráfego e janela de plantio.",
      color: "#0284C7",
      borderColor: "#1D4ED8",
      gradientId: "agroshield-soil-moisture",
      isDemo,
      critical: false,
    };
  }

  if (layer === "heat") {
    const isDemo = analysis.canopyTempC === undefined || analysis.source === "demo";
    const value = isDemo ? 31 : (analysis.canopyTempC ?? 31);
    const status = value >= 30 ? "Atenção Pulverização" : "Faixa moderada";
    return {
      title: "Estresse Térmico",
      buttonLabel: "Calor",
      buttonValue: `${Math.round(value)}°C`,
      markerValue: `🌡️ Temp. Dossel: ${Math.round(value)}°C (${status})`,
      status,
      source: isDemo
        ? "Demonstrativo · ECOSTRESS indisponível na API"
        : analysis.canopyTempSource || "API · temperatura do dossel",
      whyItMatters:
        "A temperatura do dossel contextualiza estresse térmico e pode alterar a janela de pulverização.",
      color: "#EA580C",
      borderColor: "#F59E0B",
      gradientId: "agroshield-heat",
      isDemo,
      critical: false,
    };
  }

  const isDemo = analysis.groundCoverPercent === undefined || analysis.source === "demo";
  const value = boundedPercent(isDemo ? undefined : analysis.groundCoverPercent, 42);
  const lowCover = value < 50;
  const status = lowCover ? "Baixa proteção" : "Boa proteção";
  return {
    title: "Cobertura e Palhada",
    buttonLabel: "Solo/Palhada",
    buttonValue: `${value}%`,
    markerValue: `🛡️ Cobertura Palhada: ${value}% (${status})`,
    status,
    source: isDemo
      ? "Demonstrativo · cobertura não informada pela API"
      : analysis.groundCoverSource || "API · cobertura do solo",
    whyItMatters: "A cobertura reduz exposição do solo, erosão e perda de água entre safras.",
    color: lowCover ? "#B45309" : "#65A30D",
    borderColor: lowCover ? "#92400E" : "#4D7C0F",
    gradientId: lowCover ? "agroshield-cover-low" : "agroshield-cover-high",
    isDemo,
    critical: false,
  };
}
