const CAMPO_MOURAO_COORDINATES = { latitude: -24.045, longitude: -52.383 };

export interface CurrentWeather {
  temperatureC: number;
  precipitationTodayMm: number;
  time: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function getCampoMouraoWeather(): Promise<CurrentWeather> {
  const params = new URLSearchParams({
    latitude: String(CAMPO_MOURAO_COORDINATES.latitude),
    longitude: String(CAMPO_MOURAO_COORDINATES.longitude),
    current: "temperature_2m",
    hourly: "precipitation",
    temperature_unit: "celsius",
    timezone: "America/Sao_Paulo",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Open-Meteo indisponível");

  const result: unknown = await response.json();
  if (!isRecord(result) || !isRecord(result["current"])) {
    throw new Error("Resposta inválida do Open-Meteo");
  }
  const current = result["current"];
  const temperatureC = current["temperature_2m"];
  const time = current["time"];
  if (
    typeof temperatureC !== "number" ||
    !Number.isFinite(temperatureC) ||
    temperatureC < -90 ||
    temperatureC > 60 ||
    typeof time !== "string"
  ) {
    throw new Error("Temperatura inválida do Open-Meteo");
  }

  if (!isRecord(result["hourly"])) throw new Error("Precipitação inválida do Open-Meteo");
  const hourly = result["hourly"];
  const times = hourly["time"];
  const precipitation = hourly["precipitation"];
  if (
    !Array.isArray(times) ||
    !Array.isArray(precipitation) ||
    times.length !== precipitation.length
  ) {
    throw new Error("Precipitação inválida do Open-Meteo");
  }

  const today = time.slice(0, 10);
  let precipitationTodayMm = 0;
  let hasTodayReading = false;
  for (let index = 0; index < times.length; index += 1) {
    const hour = times[index];
    const amount = precipitation[index];
    if (
      typeof hour === "string" &&
      hour.startsWith(`${today}T`) &&
      hour <= time &&
      typeof amount === "number" &&
      Number.isFinite(amount) &&
      amount >= 0
    ) {
      precipitationTodayMm += amount;
      hasTodayReading = true;
    }
  }
  if (!hasTodayReading) throw new Error("Sem leituras de precipitação para hoje");

  return { temperatureC, precipitationTodayMm: Number(precipitationTodayMm.toFixed(1)), time };
}
