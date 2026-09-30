import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export function Markdown({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<div className={cn("min-w-0 break-words", className)}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					h1: (props) => (
						<h1
							className="mt-4 mb-2 text-xl font-semibold first:mt-0"
							{...props}
						/>
					),
					h2: (props) => (
						<h2
							className="mt-4 mb-2 text-lg font-semibold first:mt-0"
							{...props}
						/>
					),
					h3: (props) => (
						<h3 className="mt-3 mb-1.5 font-semibold first:mt-0" {...props} />
					),
					p: (props) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
					ul: (props) => (
						<ul className="my-2 list-disc space-y-1 pl-5" {...props} />
					),
					ol: (props) => (
						<ol className="my-2 list-decimal space-y-1 pl-5" {...props} />
					),
					li: (props) => <li className="pl-0.5" {...props} />,
					strong: (props) => (
						<strong className="font-semibold text-text" {...props} />
					),
					a: (props) => (
						<a
							className="text-brand underline underline-offset-2"
							{...props}
							target="_blank"
							rel="noreferrer"
						/>
					),
					blockquote: (props) => (
						<blockquote
							className="my-2 border-l-2 border-brand pl-3 text-text-secondary"
							{...props}
						/>
					),
					code: (props) => (
						<code
							className="rounded bg-bg px-1 py-0.5 font-mono text-[0.9em] [overflow-wrap:anywhere]"
							{...props}
						/>
					),
					pre: (props) => (
						<pre
							className="my-3 max-w-full overflow-x-auto overscroll-x-contain rounded-md bg-bg p-3 font-mono text-xs [&_code]:[overflow-wrap:normal]"
							{...props}
						/>
					),
					table: (props) => (
						// A wide table scrolls inside its own box, never the page.
						<div className="my-3 max-w-full overflow-x-auto overscroll-x-contain rounded-md border border-border">
							<table
								className="w-full min-w-[32rem] border-collapse text-xs"
								{...props}
							/>
						</div>
					),
					th: (props) => (
						<th
							className="border-b border-border bg-bg px-2 py-1.5 text-left font-semibold"
							{...props}
						/>
					),
					td: (props) => (
						<td
							className="border-b border-border px-2 py-1.5 last:border-0"
							{...props}
						/>
					),
					hr: () => <hr className="my-4 border-border" />,
				}}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
}
