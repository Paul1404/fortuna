import { useCallback, useEffect, useState } from "react";

/**
 * Recently used categories, newest first.
 *
 * Kept in the browser: it is a convenience for the person holding this
 * device, not a fact about their money, and losing it costs one extra tap.
 */
const STORAGE_KEY = "fortuna.recent-categories";
export const RECENT_LIMIT = 6;

/** `id` moved to the front, without duplicates, capped at `limit`. */
export function rememberRecent(
	recent: readonly string[],
	id: string,
	limit = RECENT_LIMIT,
): string[] {
	return [id, ...recent.filter((other) => other !== id)].slice(0, limit);
}

type PickerCategory = {
	id: string;
	name: string;
	parentId: string | null;
};

/** Case- and accent-insensitive, so "gebuhr" finds "Gebühren". */
export function normaliseForSearch(value: string): string {
	return value
		.toLocaleLowerCase("de")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.replace(/ß/g, "ss")
		.trim();
}

/**
 * What the category picker shows: the recent ones that still exist (a
 * deleted category silently drops out), then every category matching the
 * query in the order it was given. While a query is typed there is no recent
 * row, only matches, and whether one of them is an exact hit — without one,
 * "Neue Kategorie" offers the typed name.
 */
export function pickerCategories<C extends PickerCategory>(
	categories: readonly C[],
	recent: readonly string[],
	query: string,
): { recent: C[]; matches: C[]; exact: boolean } {
	const needle = normaliseForSearch(query);
	if (!needle) {
		const byId = new Map(categories.map((category) => [category.id, category]));
		return {
			recent: recent
				.map((id) => byId.get(id))
				.filter((category): category is C => Boolean(category)),
			matches: [...categories],
			exact: false,
		};
	}
	const matches = categories.filter((category) =>
		normaliseForSearch(category.name).includes(needle),
	);
	// Names that start with the query are what the owner is typing towards.
	matches.sort(
		(left, right) =>
			Number(normaliseForSearch(right.name).startsWith(needle)) -
			Number(normaliseForSearch(left.name).startsWith(needle)),
	);
	return {
		recent: [],
		matches,
		exact: matches.some(
			(category) => normaliseForSearch(category.name) === needle,
		),
	};
}

/**
 * The categories that fit the booking's direction first: an expense is
 * rarely filed under "Gehalt", and scrolling past every income category on
 * a phone to reach "Lebensmittel" was the slow part. Stable, so parents
 * keep their children beneath them; nothing is hidden.
 */
export function forDirection<C extends { kind?: string }>(
	categories: readonly C[],
	outflow: boolean,
): C[] {
	const fits = (category: C) => (category.kind === "income") !== outflow;
	return [...categories].sort(
		(left, right) => Number(fits(right)) - Number(fits(left)),
	);
}

function read(): string[] {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed)
			? parsed.filter((id): id is string => typeof id === "string")
			: [];
	} catch {
		return [];
	}
}

/** The recent list and a way to push a category onto it. */
export function useRecentCategories(): [string[], (id: string) => void] {
	const [recent, setRecent] = useState<string[]>([]);
	// Read after mount: the server render has no storage, and a mismatch
	// between the two renders would be a hydration error.
	useEffect(() => setRecent(read()), []);
	const push = useCallback((id: string) => {
		const next = rememberRecent(read(), id);
		setRecent(next);
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {
			// Private windows and blocked storage: the list simply stays short.
		}
	}, []);
	return [recent, push];
}
