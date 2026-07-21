// FR-11 (components.md "Sidebar Folder"): the three-band drop-target
// geometry shared by every sidebar row — project rows and folder headers
// alike. Top/bottom ~25% mean "reorder — insert before/after this row";
// the middle ~50% means "merge/move into this row or folder". One function
// so every row resolves the bands identically, the same way Split Pane
// Container's four triangular zones are computed in exactly one place.
export type SidebarDropBand = "before" | "merge" | "after";

const EDGE_BAND_FRACTION = 0.25;

export function computeSidebarDropBand(rect: DOMRect, clientY: number): SidebarDropBand {
	const fraction = rect.height === 0 ? 0.5 : (clientY - rect.top) / rect.height;
	if (fraction < EDGE_BAND_FRACTION) return "before";
	if (fraction > 1 - EDGE_BAND_FRACTION) return "after";
	return "merge";
}
