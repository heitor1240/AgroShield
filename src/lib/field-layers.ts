import type { FieldAnalysis, Risk } from "@/services/agroShieldApi";
import type { CurrentWeather } from "@/services/fieldWeather";

export type FieldMapLayer =
  | "alert"
  | "ndvi"
  | "rain-heatmap"
  | "soil-moisture"
  | "heat"
  | "cover";

export interface FieldLayerProgress {
  value: number;
  max: number;
  idealStart: number;
  idealEnd: number;
}

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
  progress: FieldLayerProgress | null;
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

export function getFieldLayerView(
  analysis: FieldAnalysis,
  layer: FieldMapLayer,
  currentWeather: CurrentWeather | null = null,
): FieldLayerView {
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
      progress: null,
    };
  }

  if (layer === "ndvi") {
    const isDemo = analysis.source === "demo" || analysis.ndviPercent === undefined;
    const value = boundedPercent(isDemo ? undefined : analysis.ndviPercent, 84);
    const status =
      value >= 70 ? "Vigor vegetativo alto" : value >= 50 ? "Vigor moderado" : "Vigor baixo";
    return {
      title: "Verde da lavoura",
      buttonLabel: "Verde da lavoura",
      buttonValue: `${(value / 100).toFixed(2)} · ${value}%`,
      markerValue: `🌱 NDVI ${(value / 100).toFixed(2)} (${value}%) · ${status}`,
      status,
      source: isDemo
        ? "Demonstrativo · MODIS/HLS sem leitura ao vivo"
        : analysis.ndviSource || "MODIS/HLS · NDVI",
      whyItMatters: "O NDVI indica vigor e uniformidade da vegetação; nuvens e resolução limitam a leitura.",
      color: "#059669",
      borderColor: "#10B981",
      gradientId: "agroshield-ndvi",
      isDemo,
      critical: false,
      progress: { value, max: 100, idealStart: 70, idealEnd: 92 },
    };
  }

  if (layer === "rain-heatmap") {
    const rainMm = currentWeather?.precipitationTodayMm;
    const hasReading = typeof rainMm === "number" && Number.isFinite(rainMm) && rainMm >= 0;
    const rainHigh = hasReading && rainMm >= 20;
    const rainModerate = hasReading && rainMm >= 5;
    const status = !hasReading
      ? "Sem leitura"
      : rainHigh
        ? "Chuva intensa hoje"
        : rainModerate
          ? "Chuva moderada hoje"
          : rainMm > 0
            ? "Chuva leve hoje"
            : "Sem chuva hoje";
    const rainText = hasReading
      ? `${rainMm.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm`
      : "—";
    const color = rainHigh ? "#1D4ED8" : rainModerate ? "#0284C7" : "#0EA5E9";
    return {
      title: "Precipitação acumulada hoje",
      buttonLabel: "Chuva hoje",
      buttonValue: rainText,
      markerValue: hasReading
        ? `🌧️ Chuva hoje: ${rainText} (estimativa)`
        : "🌧️ Acumulado de hoje indisponível",
      status,
      source: hasReading
        ? `Open-Meteo · acumulado estimado hoje até ${currentWeather?.time.slice(11, 16) ?? "—"}`
        : "Open-Meteo · leitura de hoje indisponível",
      whyItMatters: hasReading
        ? "Acumulado estimado desde a meia-noite com dados meteorológicos de modelo; não é leitura de pluviômetro."
        : "O acumulado de precipitação de hoje não está disponível no momento.",
      color,
      borderColor: rainHigh ? "#1E3A8A" : rainModerate ? "#0369A1" : "#0284C7",
      gradientId: !hasReading
        ? null
        : rainHigh
        ? "agroshield-rain-heat-high"
        : rainModerate
          ? "agroshield-rain-heat-mid"
          : "agroshield-rain-heat-low",
      isDemo: false,
      critical: false,
      progress: null,
    };
  }

  if (layer === "soil-moisture") {
    const hasRootZone = typeof analysis.rootZoneMoisture === "number";
    const isDemo =
      analysis.source === "demo" || (!hasRootZone && analysis.soilMoisture === undefined);
    const value = boundedPercent(
      isDemo ? undefined : (analysis.rootZoneMoisture ?? analysis.soilMoisture),
      68,
    );
    const status =
      value >= 75
        ? "Acima da capacidade de campo"
        : value >= 45
          ? "Reserva hídrica adequada"
          : "Solo seco";
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
      progress: { value, max: 100, idealStart: 45, idealEnd: 70 },
    };
  }

  if (layer === "heat") {
    const isDemo = analysis.canopyTempC === undefined || analysis.source === "demo";
    const value = isDemo ? 32.1 : (analysis.canopyTempC ?? 32.1);
    const status = isDemo
      ? "Pico térmico demonstrativo · validar pausa"
      : value >= 30
        ? "Pico térmico vespertino · avaliar pausa"
        : "Faixa térmica adequada";
    return {
      title: "Calor do Dossel",
      buttonLabel: "Calor do dossel",
      buttonValue: `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}°C`,
      markerValue: `🌡️ Temp. Dossel: ${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}°C (${status})`,
      status,
      source: isDemo
        ? "Demonstrativo · NASA ECOSTRESS não conectado"
        : analysis.canopyTempSource || "API · temperatura do dossel",
      whyItMatters:
        "A temperatura do dossel contextualiza estresse térmico e pode alterar a janela de pulverização.",
      color: "#EA580C",
      borderColor: "#F59E0B",
      gradientId: "agroshield-heat",
      isDemo,
      critical: false,
      progress: { value: Math.min(value, 50), max: 50, idealStart: 18, idealEnd: 30 },
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
    whyItMatters: isDemo
      ? "Cobertura baixa acelera o aquecimento do solo; avalie rotação com braquiária."
      : "A cobertura reduz exposição do solo, erosão e perda de água entre safras.",
    color: lowCover ? "#B45309" : "#65A30D",
    borderColor: lowCover ? "#92400E" : "#4D7C0F",
    gradientId: lowCover ? "agroshield-cover-low" : "agroshield-cover-high",
    isDemo,
    critical: false,
    progress: { value, max: 100, idealStart: 70, idealEnd: 100 },
  };
}
