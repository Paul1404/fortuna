import changelog from "../../CHANGELOG.md?raw";

export type Release = {
	version: string;
	date: string | null;
	notes: string[];
};

const HEADING = /^##\s+(\S+)(?:\s*-\s*(.+))?$/;

export function parseReleases(raw: string): Release[] {
	const releases: Release[] = [];
	let current: Release | null = null;
	let pendingNote: string | null = null;

	const flushNote = () => {
		if (current && pendingNote !== null) {
			const note = pendingNote.trim();
			if (note) current.notes.push(note);
		}
		pendingNote = null;
	};

	for (const line of raw.split("\n")) {
		const heading = line.match(HEADING);
		if (heading) {
			flushNote();
			current = {
				version: heading[1],
				date: heading[2]?.trim() ?? null,
				notes: [],
			};
			releases.push(current);
			continue;
		}

		if (!current) continue;
		const bullet = line.match(/^-\s+(.*)$/);
		if (bullet) {
			flushNote();
			pendingNote = bullet[1];
			continue;
		}

		const trimmed = line.trim();
		if (!trimmed) {
			flushNote();
		} else if (pendingNote !== null) {
			pendingNote += ` ${trimmed}`;
		}
	}

	flushNote();
	return releases;
}

export const RELEASES = parseReleases(changelog);
