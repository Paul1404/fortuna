import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { schema } from "./index";

/** The deployed code's table/column contract, with no owner records read. */
export const expectedDatabaseColumns = Object.values(schema).flatMap(
	(value) => {
		if (!is(value, PgTable)) return [];
		const config = getTableConfig(value);
		return config.columns.map((column) => ({
			schema_name: config.schema ?? "public",
			table_name: config.name,
			column_name: column.name,
		}));
	},
);

export async function checkDatabaseSchema(
	client: Pick<Pool, "query">,
	columns = expectedDatabaseColumns,
): Promise<{ db: boolean; schema: boolean }> {
	const result = await client.query<{ ready: boolean }>({
		text: `select not exists (
			select 1 from jsonb_to_recordset($1::jsonb)
				as expected(schema_name text, table_name text, column_name text)
			where not exists (
				select 1 from information_schema.columns actual
				where actual.table_schema = expected.schema_name
					and actual.table_name = expected.table_name
					and actual.column_name = expected.column_name
			)
		) as ready`,
		values: [JSON.stringify(columns)],
	});
	return { db: true, schema: result.rows[0]?.ready === true };
}
