import { describe, it, expect } from "vitest";
import { formatCombo, hasRequiredModifier, matchesCombo, actionLabel, KEYBINDING_ACTIONS, DEFAULT_KEYBINDINGS } from "./keybindings";

function keydown(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
	return { type: "keydown", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: "KeyA", ...overrides } as KeyboardEvent;
}

describe("formatCombo", () => {
	it("orders modifiers Ctrl, Alt, Shift, Cmd", () => {
		const event = keydown({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: true, code: "KeyD" });
		expect(formatCombo(event)).toBe("Ctrl+Alt+Shift+Cmd+D");
	});

	it("matches the registry's own default strings exactly", () => {
		expect(formatCombo(keydown({ ctrlKey: true, shiftKey: true, code: "KeyC" }))).toBe("Ctrl+Shift+C");
		expect(formatCombo(keydown({ ctrlKey: true, shiftKey: true, code: "KeyV" }))).toBe("Ctrl+Shift+V");
		expect(formatCombo(keydown({ altKey: true, shiftKey: true, code: "KeyD" }))).toBe("Alt+Shift+D");
		expect(formatCombo(keydown({ altKey: true, shiftKey: true, code: "KeyR" }))).toBe("Alt+Shift+R");
		expect(formatCombo(keydown({ altKey: true, code: "ArrowLeft" }))).toBe("Alt+ArrowLeft");
		expect(formatCombo(keydown({ altKey: true, code: "ArrowRight" }))).toBe("Alt+ArrowRight");
		expect(formatCombo(keydown({ altKey: true, code: "ArrowUp" }))).toBe("Alt+ArrowUp");
		expect(formatCombo(keydown({ altKey: true, code: "ArrowDown" }))).toBe("Alt+ArrowDown");
		expect(formatCombo(keydown({ ctrlKey: true, code: "Equal" }))).toBe("Ctrl+=");
		expect(formatCombo(keydown({ ctrlKey: true, code: "Minus" }))).toBe("Ctrl+-");
		expect(formatCombo(keydown({ ctrlKey: true, code: "Tab" }))).toBe("Ctrl+Tab");
		expect(formatCombo(keydown({ ctrlKey: true, shiftKey: true, code: "Tab" }))).toBe("Ctrl+Shift+Tab");
	});

	it("strips the Key/Digit code prefix but leaves other codes (e.g. Arrow*) untouched", () => {
		expect(formatCombo(keydown({ code: "KeyZ" }))).toBe("Z");
		expect(formatCombo(keydown({ code: "Digit1" }))).toBe("1");
		expect(formatCombo(keydown({ code: "ArrowLeft" }))).toBe("ArrowLeft");
	});

	it("maps the Equal/Minus physical-key codes to '='/'-' (the zoom in/out keys)", () => {
		expect(formatCombo(keydown({ code: "Equal" }))).toBe("=");
		expect(formatCombo(keydown({ code: "Minus" }))).toBe("-");
	});

	it("is case/format-consistent by construction — same physical combo always yields the same string", () => {
		const a = formatCombo(keydown({ ctrlKey: true, shiftKey: true, code: "KeyC" }));
		const b = formatCombo(keydown({ shiftKey: true, ctrlKey: true, code: "KeyC" })); // same keys, different object key order
		expect(a).toBe(b);
	});
});

describe("hasRequiredModifier", () => {
	it("accepts Ctrl, Alt, or Meta alone", () => {
		expect(hasRequiredModifier(keydown({ ctrlKey: true }))).toBe(true);
		expect(hasRequiredModifier(keydown({ altKey: true }))).toBe(true);
		expect(hasRequiredModifier(keydown({ metaKey: true }))).toBe(true);
	});

	it("rejects Shift alone and no modifier at all", () => {
		expect(hasRequiredModifier(keydown({ shiftKey: true }))).toBe(false);
		expect(hasRequiredModifier(keydown({}))).toBe(false);
	});
});

describe("matchesCombo", () => {
	it("matches when the event's canonical combo equals the stored string", () => {
		const event = keydown({ ctrlKey: true, shiftKey: true, code: "KeyC" });
		expect(matchesCombo(event, "Ctrl+Shift+C")).toBe(true);
	});

	it("does not match a different combo", () => {
		const event = keydown({ ctrlKey: true, shiftKey: true, code: "KeyC" });
		expect(matchesCombo(event, "Ctrl+Shift+V")).toBe(false);
	});

	it("returns false for an undefined/empty combo rather than throwing", () => {
		const event = keydown({ ctrlKey: true, shiftKey: true, code: "KeyC" });
		expect(matchesCombo(event, undefined)).toBe(false);
		expect(matchesCombo(event, "")).toBe(false);
	});
});

describe("actionLabel", () => {
	it("returns the registered label for a known action id", () => {
		expect(actionLabel("clipboard.copy")).toBe("Copy selection");
	});

	it("falls back to the id itself for an unknown action", () => {
		expect(actionLabel("something.unregistered")).toBe("something.unregistered");
	});
});

describe("KEYBINDING_ACTIONS / DEFAULT_KEYBINDINGS", () => {
	it("has exactly 13 actions, matching architecture.md §5.6's registry", () => {
		expect(KEYBINDING_ACTIONS).toHaveLength(13);
	});

	it("terminal.closeSession defaults to Ctrl+Shift+W (Tilix/Terminator parity)", () => {
		expect(DEFAULT_KEYBINDINGS["terminal.closeSession"]).toBe("Ctrl+Shift+W");
	});

	it("every action has a default combo, and every default combo is unique", () => {
		const combos = KEYBINDING_ACTIONS.map((a) => DEFAULT_KEYBINDINGS[a.id]);
		expect(combos.every((c) => !!c)).toBe(true);
		expect(new Set(combos).size).toBe(combos.length);
	});
});
