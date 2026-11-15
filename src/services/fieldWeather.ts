const CAMPO_MOURAO_COORDINATES = { latitude: -24.045, longitude: -52.383 };

export interface CurrentWeather {
  temperatureC: number;
  relativeHumidityPct: number | null;
  maxTemperatureTodayC: number | null;
  precipitationTodayMm: number;
  time: string;
  hourlyForecast: HourlyWeatherForecast[];
}

export interface HourlyWeatherForecast {
  time: string;
  temperatureC: number;
  relativeHumidityPct: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function getCampoMouraoWeather(
  latitude: number = CAMPO_MOURAO_COORDINATES.latitude,
  longitude: number = CAMPO_MOURAO_COORDINATES.longitude,
): Promise<CurrentWeather> {
  const validCoords =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;
  const params = new URLSearchParams({
    latitude: String(validCoords ? latitude : CAMPO_MOURAO_COORDINATES.latitude),
    longitude: String(validCoords ? longitude : CAMPO_MOURAO_COORDINATES.longitude),
    current: "temperature_2m,relative_humidity_2m",
    hourly: "precipitation,temperature_2m,relative_humidity_2m",
    daily: "temperature_2m_max",
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
  const humidity = current["relative_humidity_2m"];
  const relativeHumidityPct =
    typeof humidity === "number" && Number.isFinite(humidity) && humidity >= 0 && humidity <= 100
      ? humidity
      : null;

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
  const hourlyTemperatures = hourly["temperature_2m"];
  const hourlyHumidity = hourly["relative_humidity_2m"];
  const hourlyForecast: HourlyWeatherForecast[] = [];
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
    const hourlyTemperature = Array.isArray(hourlyTemperatures)
      ? hourlyTemperatures[index]
      : undefined;
    if (
      typeof hour === "string" &&
      hour.startsWith(`${today}T`) &&
      typeof hourlyTemperature === "number" &&
      Number.isFinite(hourlyTemperature) &&
      hourlyTemperature >= -90 &&
      hourlyTemperature <= 60
    ) {
      const hourlyHumidityPct = Array.isArray(hourlyHumidity) ? hourlyHumidity[index] : undefined;
      hourlyForecast.push({
        time: hour,
        temperatureC: hourlyTemperature,
        relativeHumidityPct:
          typeof hourlyHumidityPct === "number" &&
          Number.isFinite(hourlyHumidityPct) &&
          hourlyHumidityPct >= 0 &&
          hourlyHumidityPct <= 100
            ? hourlyHumidityPct
            : null,
      });
    }
  }
  if (!hasTodayReading) throw new Error("Sem leituras de precipitação para hoje");

  let maxTemperatureTodayC: number | null = null;
  if (isRecord(result["daily"])) {
    const daily = result["daily"];
    const dailyTimes = daily["time"];
    const dailyMaxima = daily["temperature_2m_max"];
    if (Array.isArray(dailyTimes) && Array.isArray(dailyMaxima)) {
      const todayIndex = dailyTimes.findIndex((date) => date === today);
      const maximum = dailyMaxima[todayIndex];
      if (
        todayIndex >= 0 &&
        typeof maximum === "number" &&
        Number.isFinite(maximum) &&
        maximum >= -90 &&
        maximum <= 60
      ) {
        maxTemperatureTodayC = maximum;
      }
    }
  }

  return {
    temperatureC,
    relativeHumidityPct,
    maxTemperatureTodayC,
    precipitationTodayMm: Number(precipitationTodayMm.toFixed(1)),
    time,
    hourlyForecast,
  };
}
