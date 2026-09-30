import { useEffect } from "react";

/**
 * Publishes the visible viewport as CSS variables on `<html>`:
 *
 * - `--app-vvh`: the height actually visible, keyboard excluded;
 * - `--keyboard-inset`: how far the on-screen keyboard covers the layout
 *   viewport from below (iOS Safari keeps the layout viewport full height
 *   and lays the keyboard over it, so `100dvh` never shrinks there);
 * - `data-keyboard="open"` while a field has focus and the keyboard is up
 *   (Android shrinks the layout viewport instead, so the inset stays 0 and
 *   the attribute is read from the lost height).
 *
 * Bottom sheets sit on the inset and the phone tab bar steps aside, so the
 * field being typed into and the chat composer stay above the keyboard.
 * A pinch zoom also shrinks the visual viewport; it is not a keyboard.
 */
export function useViewportVars() {
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const root = document.documentElement;
		let baseline = 0;
		let lastWidth = 0;
		let frame = 0;
		const update = () => {
			frame = 0;
			if (window.innerWidth !== lastWidth) {
				lastWidth = window.innerWidth;
				baseline = 0;
			}
			baseline = Math.max(baseline, window.innerHeight);
			const zoomed = vv.scale > 1.01;
			const inset = zoomed
				? 0
				: Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
			const visible = zoomed ? window.innerHeight : vv.height;
			root.style.setProperty("--app-vvh", `${Math.round(visible)}px`);
			root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
			const active = document.activeElement;
			const typing =
				active instanceof HTMLElement &&
				(active.isContentEditable || active.matches("input, textarea, select"));
			const keyboard =
				!zoomed && typing && (inset > 120 || baseline - vv.height > 150);
			if (keyboard) root.dataset.keyboard = "open";
			else delete root.dataset.keyboard;
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};
		update();
		vv.addEventListener("resize", schedule);
		vv.addEventListener("scroll", schedule);
		window.addEventListener("resize", schedule);
		document.addEventListener("focusin", schedule);
		document.addEventListener("focusout", schedule);
		return () => {
			if (frame) cancelAnimationFrame(frame);
			vv.removeEventListener("resize", schedule);
			vv.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			document.removeEventListener("focusin", schedule);
			document.removeEventListener("focusout", schedule);
		};
	}, []);
}
