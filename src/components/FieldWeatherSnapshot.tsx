import { CalendarDays, CloudRain, Droplets, Thermometer } from "lucide-react";
import type { CurrentWeather } from "@/services/fieldWeather";

function formatDayLabel(time: string | null) {
  const date = time
    ? new Date(`${time.slice(0, 10)}T12:00:00-03:00`)
    : new Date();
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo",
  })
    .format(date)
    .replace(".", "");
}

function formatTemperature(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

export default function FieldWeatherSnapshot({
  weather,
}: {
  weather: CurrentWeather | null;
}) {
  return (
    <section className="weather-snapshot" aria-label="Condições meteorológicas em Campo Mourão">
      <header className="weather-snapshot-header">
        <span className="eyebrow">MONITORAMENTO REGIONAL</span>
        <span className="weather-source-badge">OPEN-METEO · MODELO</span>
      </header>
      <div className="weather-snapshot-main">
        <div className="weather-snapshot-location">
          <strong>Campo Mourão, PR</strong>
          <span><CalendarDays size={12} /> {formatDayLabel(weather?.time ?? null)}</span>
        </div>
        {weather ? (
          <div className="weather-snapshot-temperature">
            <span><Thermometer size={14} /> {formatTemperature(weather.temperatureC)}°C agora</span>
            <strong>
              {weather.maxTemperatureTodayC === null
                ? "Máx. indisponível"
                : `→ Máx. ${formatTemperature(weather.maxTemperatureTodayC)}°C`}
            </strong>
          </div>
        ) : (
          <strong className="weather-snapshot-unavailable">Dados indisponíveis</strong>
        )}
      </div>
      {weather && (
        <div className="weather-snapshot-details">
          <span>
            <Droplets size={12} />
            {weather.relativeHumidityPct === null
              ? "UR indisponível"
              : `UR ${weather.relativeHumidityPct}%`}
          </span>
          <span>
            <CloudRain size={12} />
            {formatTemperature(weather.precipitationTodayMm)} mm hoje · estimativa
          </span>
          <span className="weather-snapshot-updated">Atualizado {weather.time.slice(11, 16)}</span>
        </div>
      )}
      <p>Previsão meteorológica regional; não é observação de estação no talhão.</p>
    </section>
  );
}
