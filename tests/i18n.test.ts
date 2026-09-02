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
        "Le patch gameplay retiré n’a pas pu être supprimé. Ferme H1Z1 puis réessaie.",
        "en",
      ),
    ).toBe("The retired gameplay patch could not be removed. Close H1Z1 and try again.");
    expect(
      localizeServiceError(
        "Un dinput8.dll inconnu est présent dans le client ROTK. Supprime-le ou réimporte un client propre.",
        "en",
      ),
    ).toBe("An unknown dinput8.dll is present in the ROTK client. Remove it or import a clean client again.");
  });

  it("localizes internal English errors for the French interface", () => {
    expect(localizeServiceError("Invalid ROTK session identity", "fr")).toBe(
      "L’identité de session ROTK est invalide.",
    );
  });
});
