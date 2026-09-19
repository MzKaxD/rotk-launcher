import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareInterfaceInputProfile, synchronizeInterfaceInputProfile } from "../electron/services/interface-input-profile.js";

const defaults = `<Profile name="Default" version="13">
  <ActionSet name="Generic">
    <Action name="OpenMap" ignoreModifiers="false" version="5"><Trigger>M</Trigger><Trigger>Gamepad_1_Button_Pov0Right</Trigger></Action>
    <Action name="ToggleInventory" ignoreModifiers="false"><Trigger>Tab</Trigger><Trigger>I</Trigger></Action>
    <Action name="ToggleMuteVoice"><Trigger>Alt+M</Trigger></Action>
    <Action name="ToggleMuteAll"><Trigger>Control+M</Trigger></Action>
    <Action name="CycleMainWindowTabs"><Trigger>Control+Tab</Trigger></Action>
  </ActionSet>
  <ActionSet name="Infantry">
    <Action name="Sprint" ignoreModifiers="true"><Trigger>Shift_Left</Trigger><Trigger>Shift_Right</Trigger></Action>
    <Action name="Reload" ignoreModifiers="true"><Trigger>R</Trigger></Action>
  </ActionSet>
</Profile>`;
const user = defaults.replace('name="Default"', 'name="User"');
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(join(tmpdir(), "rotk-interface-input-")))) throw new Error("Unsafe test cleanup");
    await rm(root, { recursive: true, force: true });
  }
});

describe("interface shortcuts while holding Shift", () => {
  it("adds exact Shift chords without changing sprint, Ctrl/Alt actions or modifier policy", () => {
    const result = synchronizeInterfaceInputProfile(user, defaults);
    expect(result.managed).toEqual({ OpenMap: ["Shift+M"], ToggleInventory: ["Shift+Tab", "Shift+I"] });
    for (const trigger of ["Shift+M", "Shift+Tab", "Shift+I"]) expect(result.text).toContain(`<Trigger>${trigger}</Trigger>`);
    expect(result.text).not.toContain("Shift+Gamepad");
    expect(result.text).toContain('<Action name="OpenMap" ignoreModifiers="false" version="5">');
    for (const name of ["ToggleMuteVoice", "ToggleMuteAll", "CycleMainWindowTabs", "Sprint", "Reload"]) {
      const pattern = new RegExp(`<Action name="${name}"[\\s\\S]*?</Action>`);
      expect(result.text.match(pattern)?.[0]).toBe(user.match(pattern)?.[0]);
    }
  });

  it("uses custom keys, including mouse buttons, and keeps explicit multi-key bindings", () => {
    const custom = user.replace("<Trigger>M</Trigger>", "<Trigger>P</Trigger>")
      .replace("<Trigger>Tab</Trigger>", "<Trigger>Mouse_2</Trigger>")
      .replace("<Trigger>I</Trigger>", "<Trigger>Alt+B</Trigger>");
    const result = synchronizeInterfaceInputProfile(custom, defaults);
    expect(result.managed).toEqual({ OpenMap: ["Shift+P"], ToggleInventory: ["Shift+Mouse_2"] });
    expect(result.text).toContain("<Trigger>Alt+B</Trigger>");
    expect(result.text).not.toContain("Shift+M</Trigger>");
    expect(result.text).not.toContain("Shift+Alt+B");
  });

  it("does not duplicate or claim ownership of an existing player-defined Shift binding", () => {
    const custom = user.replace("<Trigger>M</Trigger>", "<Trigger>M</Trigger><Trigger>Shift+M</Trigger>");
    const result = synchronizeInterfaceInputProfile(custom, defaults);
    expect(result.managed.OpenMap).toBeUndefined();
    expect(result.text.match(/<Trigger>Shift\+M<\/Trigger>/g)).toHaveLength(1);
  });

  it("preserves conflicting Shift chords in other effective actions, including inherited and side-specific bindings", () => {
    const conflicting = defaults.replace('<Trigger>Alt+M</Trigger>', '<Trigger>Shift_Left+M</Trigger>');
    const custom = `<Profile name="User"><ActionSet name="Generic">
      <Action name="OpenMap"><Trigger>M</Trigger></Action>
      <Action name="ToggleInventory"><Trigger>Tab</Trigger></Action>
      <Action name="Other"><Trigger>Shift_Right+Tab</Trigger></Action>
    </ActionSet></Profile>`;
    const result = synchronizeInterfaceInputProfile(custom, conflicting);
    expect(result.text).toBe(custom);
    expect(result.managed).toEqual({});
  });

  it("is byte-idempotent across repeated launches and after the client rewrites XML", () => {
    const first = synchronizeInterfaceInputProfile(user, defaults);
    const second = synchronizeInterfaceInputProfile(first.text, defaults, first.managed);
    expect(second).toEqual(first);
    const serialized = first.text.replace(/>\s+</g, "><");
    expect(synchronizeInterfaceInputProfile(serialized, defaults, first.managed).text).toBe(serialized);
    expect(synchronizeInterfaceInputProfile(first.text, defaults).text).toBe(first.text);
  });

  it("retires generated aliases after rebinding and preserves separately configured chords", () => {
    const first = synchronizeInterfaceInputProfile(user.replace("<Trigger>M</Trigger>", "<Trigger>M</Trigger><Trigger>Shift+B</Trigger>"), defaults);
    const remapped = first.text.replace("<Trigger>M</Trigger>", "<Trigger>P</Trigger>");
    const result = synchronizeInterfaceInputProfile(remapped, defaults, first.managed);
    expect(result.text).not.toContain("<Trigger>Shift+M</Trigger>");
    expect(result.text).toContain("<Trigger>Shift+P</Trigger>");
    expect(result.text).toContain("<Trigger>Shift+B</Trigger>");
  });

  it("keeps deliberately unbound actions unbound", () => {
    const empty = `<Profile name='User'><ActionSet name='Generic'><Action name='OpenMap'/><Action name='ToggleInventory'/></ActionSet></Profile>`;
    expect(synchronizeInterfaceInputProfile(empty, defaults).text).toBe(empty);
  });

  it("uses inherited bindings for first launch, partial profiles and empty Generic sets", () => {
    for (const source of [null, '<Profile name="User"></Profile>', '<Profile name="User"><ActionSet name="Generic" /></Profile>']) {
      const result = synchronizeInterfaceInputProfile(source, defaults);
      expect(result.text).toContain('name="User"');
      expect(result.text).toContain('<Trigger>Shift+M</Trigger>');
      expect(result.text).toContain('<Trigger>Shift+Tab</Trigger>');
    }
  });

  it("does not patch commented-out actions and keeps unrelated sets byte-for-byte", () => {
    const comment = '<!-- <Action name="OpenMap"><Trigger>J</Trigger></Action> -->';
    const source = user.replace('<Action name="OpenMap"', `${comment}<Action name="OpenMap"`);
    const result = synchronizeInterfaceInputProfile(source, defaults);
    expect(result.text).toContain(comment);
    expect(result.text).not.toContain("Shift+J");
    expect(result.text.split('<ActionSet name="Infantry">')[1]).toBe(source.split('<ActionSet name="Infantry">')[1]);
  });

  it("writes only the user profile, keeps a backup outside the installation and tracks remaps", async () => {
    const root = await mkdtemp(join(tmpdir(), "rotk-interface-input-")); roots.push(root);
    const stateRoot = join(root, "launcher-state");
    await writeFile(join(root, "InputProfile_Default.xml"), defaults);
    const profile = join(root, "InputProfile_User.xml");
    await writeFile(profile, user);
    await prepareInterfaceInputProfile(root, stateRoot);
    expect(await readFile(join(root, "InputProfile_Default.xml"), "utf8")).toBe(defaults);
    expect(await readFile(join(stateRoot, "InputProfile_User.before-shift.xml"), "utf8")).toBe(user);
    const first = await readFile(profile, "utf8");
    await prepareInterfaceInputProfile(root, stateRoot);
    expect(await readFile(profile, "utf8")).toBe(first);
    await writeFile(profile, first.replace("<Trigger>M</Trigger>", "<Trigger>P</Trigger>"));
    await prepareInterfaceInputProfile(root, stateRoot);
    const remapped = await readFile(profile, "utf8");
    expect(remapped).toContain("<Trigger>Shift+P</Trigger>");
    expect(remapped).not.toContain("<Trigger>Shift+M</Trigger>");
    expect(await readFile(join(stateRoot, "InputProfile_User.before-shift.xml"), "utf8")).toBe(user);
    await writeFile(join(stateRoot, "shift-interface-shortcuts.json"), "{interrupted write");
    await prepareInterfaceInputProfile(root, stateRoot);
    expect(await readFile(profile, "utf8")).toBe(remapped);
  });
});
