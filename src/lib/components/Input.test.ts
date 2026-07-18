import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Input from "./Input.svelte";

describe("Input — autofocus", () => {
	it("is not focused by default", () => {
		render(Input, { id: "f1", label: "Field" });
		expect(screen.getByLabelText("Field")).not.toHaveFocus();
	});

	it("autofocuses when explicitly requested", () => {
		render(Input, { id: "f2", label: "Field", autofocus: true });
		expect(screen.getByLabelText("Field")).toHaveFocus();
	});
});
