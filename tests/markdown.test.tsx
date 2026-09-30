import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/markdown";

describe("Copilot markdown", () => {
	it("renders emphasis, lists, tables, code and safe links", () => {
		const html = renderToStaticMarkup(
			<Markdown>{`**Wichtig**\n\n- Eins\n- Zwei\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n\`42\` [Quelle](https://example.com)`}</Markdown>,
		);
		expect(html).toContain("<strong");
		expect(html).toContain("<ul");
		expect(html).toContain("<table");
		expect(html).toContain("<code");
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noreferrer"');
	});

	it("does not render raw HTML from a model response", () => {
		const html = renderToStaticMarkup(
			<Markdown>{`<script>alert("nope")</script>`}</Markdown>,
		);
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});
});
