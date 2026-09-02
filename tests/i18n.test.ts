import { describe, expect, it } from "vitest";
import { localizeServiceError } from "../electron/i18n";
import { normalizeAppLocale } from "../shared/locale";

describe("launcher locales", () => {
  it("defaults unknown or missing preferences to English", () => {
    expect(normalizeAppLocale(undefined)).toBe("en");
    expect(normalizeAppLocale("de")).toBe("en");
    expect(normalizeAppLocale("fr")).toBe("fr");
  });

  it("localizes known and parameterized service errors in English", () => {
    expect(localizeServiceError("Le chemin doit être absolu.", "en")).toBe("The path must be absolute.");
    expect(
      localizeServiceError("Client H1Z1 incomplet : H1Z1.exe est introuvable.", "en"),
    ).toBe("Incomplete H1Z1 client: H1Z1.exe could not be found.");
    expect(
      localizeServiceError(
        "La version Vivox 5 attendue est absente du client H1Z1.",
        "en",
      ),
    ).toBe("The required Vivox 5 version is missing from the H1Z1 client.");
    expect(
      localizeServiceError(
        "Le patch crouch ROTK obligatoire n'a pas été activé correctement.",
        "en",
      ),
    ).toBe("The mandatory ROTK crouch patch was not activated correctly.");
    expect(
      localizeServiceError(
        "Le patch de gameplay ROTK obligatoire n'a pas été copié correctement.",
        "en",
      ),
    ).toBe("The mandatory ROTK gameplay patch was not copied correctly.");
  });

  it("localizes internal English errors for the French interface", () => {
    expect(localizeServiceError("Invalid ROTK session identity", "fr")).toBe(
      "L’identité de session ROTK est invalide.",
    );
  });
});
