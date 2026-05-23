/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { useAdminTable } from "@/global/hooks/useAdminTable";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { fireEvent, render, screen } from "@testing-library/react";
import { useConvexAuth } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminTable } from "./AdminTable";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
}));

vi.mock("convex/react", () => ({
	useConvexAuth: vi.fn(),
}));

type SampleRow = { name: string; role: string };

const columnHelper = createColumnHelper<SampleRow>();
const columns = [
	columnHelper.accessor("name", {
		id: "name",
		header: "Name",
		cell: (info) => <span>{info.getValue()}</span>,
	}),
	columnHelper.accessor("role", {
		id: "role",
		header: "Role",
		cell: (info) => <span>{info.getValue()}</span>,
	}),
];

const SAMPLE: SampleRow[] = [
	{ name: "Alice", role: "Manager" },
	{ name: "Bob", role: "Employee" },
	{ name: "Carol", role: "Owner" },
];

function Harness() {
	const tableState = useAdminTable<SampleRow>({
		queryOptions: { queryKey: ["admin-table-test"] } as any,
		columns,
	});

	return (
		<AdminTable
			tableState={tableState}
			entityName="rows"
			searchPlaceholder="Search rows..."
			filteredEmptyTitle="Nothing matches"
		/>
	);
}

function mockData(data: SampleRow[]) {
	vi.mocked(useQuery).mockReturnValue({
		data,
		isLoading: false,
		error: null,
		isError: false,
		refetch: vi.fn(),
	} as any);
}

describe("AdminTable global search", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(useConvexAuth).mockReturnValue({
			isLoading: false,
			isAuthenticated: true,
		} as any);
	});

	it("renders one row per data item before any input", () => {
		mockData(SAMPLE);
		render(<Harness />);

		expect(screen.getByText("Alice")).toBeInTheDocument();
		expect(screen.getByText("Bob")).toBeInTheDocument();
		expect(screen.getByText("Carol")).toBeInTheDocument();
	});

	it("filters visible rows when the user types a substring of an accessor value", () => {
		mockData(SAMPLE);
		render(<Harness />);

		fireEvent.change(screen.getByPlaceholderText("Search rows..."), {
			target: { value: "bob" },
		});

		// Only the matching row should remain rendered. Substring is
		// case-insensitive because TanStack's default `includesString` lowercases.
		expect(screen.getByText("Bob")).toBeInTheDocument();
		expect(screen.queryByText("Alice")).not.toBeInTheDocument();
		expect(screen.queryByText("Carol")).not.toBeInTheDocument();
	});

	it("matches against any accessor column, not just the first one", () => {
		mockData(SAMPLE);
		render(<Harness />);

		fireEvent.change(screen.getByPlaceholderText("Search rows..."), {
			target: { value: "owner" },
		});

		// "Owner" lives in the role column; the global filter must consider
		// every globally-filterable accessor column.
		expect(screen.getByText("Carol")).toBeInTheDocument();
		expect(screen.queryByText("Alice")).not.toBeInTheDocument();
		expect(screen.queryByText("Bob")).not.toBeInTheDocument();
	});

	it("renders the filtered-empty state when nothing matches", () => {
		mockData(SAMPLE);
		render(<Harness />);

		fireEvent.change(screen.getByPlaceholderText("Search rows..."), {
			target: { value: "zzz-no-match" },
		});

		expect(screen.getByText("Nothing matches")).toBeInTheDocument();
		expect(screen.queryByText("Alice")).not.toBeInTheDocument();
		expect(screen.queryByText("Bob")).not.toBeInTheDocument();
		expect(screen.queryByText("Carol")).not.toBeInTheDocument();
	});

	// Regression for the Members-page bug: if every column is a `display`
	// column with no accessorFn, TanStack v8 skips the global filter entirely
	// (see table-core's getCanGlobalFilter which ends in `!!column.accessorFn`).
	// Pin that behavior so a future refactor that drops accessorFn fails here
	// instead of silently breaking the search box.
	it("does NOT filter rows when every column is display-only (TanStack constraint)", () => {
		const displayColumns = [
			columnHelper.display({
				id: "name",
				header: "Name",
				cell: ({ row }) => <span>{row.original.name}</span>,
			}),
			columnHelper.display({
				id: "role",
				header: "Role",
				cell: ({ row }) => <span>{row.original.role}</span>,
			}),
		];

		function DisplayOnlyHarness() {
			const tableState = useAdminTable<SampleRow>({
				queryOptions: { queryKey: ["admin-table-display-test"] } as any,
				columns: displayColumns,
			});
			return (
				<AdminTable tableState={tableState} entityName="rows" searchPlaceholder="Search rows..." />
			);
		}

		mockData(SAMPLE);
		render(<DisplayOnlyHarness />);

		fireEvent.change(screen.getByPlaceholderText("Search rows..."), {
			target: { value: "bob" },
		});

		// All rows still render because no column has an accessorFn; this is
		// the exact failure mode the Members page suffered from.
		expect(screen.getByText("Alice")).toBeInTheDocument();
		expect(screen.getByText("Bob")).toBeInTheDocument();
		expect(screen.getByText("Carol")).toBeInTheDocument();
	});
});
