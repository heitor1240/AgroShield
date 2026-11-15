import { afterEach, describe, expect, it, vi } from "vitest";
import { searchLocation } from "@/services/locationSearch";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Location search", () => {
  it("uses a valid Brazilian result from Nominatim", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify([{ lat: "-24.046329", lon: "-52.37802" }])));

    await expect(searchLocation("Campo Mourão, PR")).resolves.toEqual([-24.046329, -52.37802]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("countrycodes=br");
  });

  it("falls back to Photon when Nominatim is unavailable", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ features: [{ geometry: { coordinates: [-52.37802, -24.046329] } }] }),
        ),
      );

    await expect(searchLocation("Campo Mourão, PR")).resolves.toEqual([-24.046329, -52.37802]);
  });

  it("does not accept invalid coordinates", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{ lat: "91", lon: "200" }])))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ features: [{ geometry: { coordinates: [200, 91] } }] })),
      );

    await expect(searchLocation("Campo Mourão, PR")).resolves.toBeNull();
  });

  it("reports when both providers are unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(searchLocation("Campo Mourão, PR")).rejects.toThrow(
      "Os serviços de busca de localização estão indisponíveis",
    );
  });
});
