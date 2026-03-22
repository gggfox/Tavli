import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import fs from "node:fs";
import { useCallback, useState } from "react";

const TODOS_FILE = "todos.json";

async function readTodos() {
	return JSON.parse(
		await fs.promises.readFile(TODOS_FILE, "utf-8").catch(() =>
			JSON.stringify(
				[
					{ id: 1, name: "Get groceries" },
					{ id: 2, name: "Buy a new phone" },
				],
				null,
				2
			)
		)
	);
}

// DEBT(TDR-0001): No authentication check on server function.
const getTodos = createServerFn({
	method: "GET",
}).handler(async () => await readTodos());

// DEBT(TDR-0001): No authentication check on server function.
const addTodo = createServerFn({ method: "POST" })
	.inputValidator((d: string) => d)
	.handler(async ({ data }) => {
		const todos = await readTodos();
		todos.push({ id: todos.length + 1, name: data });
		await fs.promises.writeFile(TODOS_FILE, JSON.stringify(todos, null, 2));
		return todos;
	});

export const Route = createFileRoute("/demo/start/server-funcs")({
	component: Home,
	loader: async () => await getTodos(),
});

function Home() {
	const todos = Route.useLoaderData();
	const router = useRouter();

	const [todo, setTodo] = useState("");

	const submitTodo = useCallback(async () => {
		await addTodo({ data: todo });
		setTodo("");
		router.invalidate();
	}, [router, todo]);

	return (
		<div
			className="flex items-center justify-center h-full bg-linear-to-br from-zinc-800 to-black p-4 text-white overflow-hidden"
			style={{
				backgroundImage:
					"radial-gradient(50% 50% at 20% 60%, #23272a 0%, #18181b 50%, #000000 100%)",
			}}
		>
			<div className="w-full max-w-2xl max-h-full p-8 rounded-xl backdrop-blur-md bg-black/50 shadow-xl border-8 border-black/10 flex flex-col overflow-hidden">
				<h1 className="text-2xl mb-4 shrink-0">Start Server Functions - Todo Example</h1>
				<ul className="mb-4 space-y-2 overflow-y-auto flex-1">
					{todos?.map((todo: { id: number; name: string }) => (
						<li
							key={todo.id}
							className="bg-white/10 border border-white/20 rounded-lg p-3 backdrop-blur-sm shadow-md"
						>
							<span className="text-lg text-white">{todo.name}</span>
						</li>
					))}
				</ul>
				<div className="flex flex-col gap-2 shrink-0">
					<input
						type="text"
						value={todo}
						onChange={(e) => setTodo(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								submitTodo();
							}
						}}
						placeholder="Enter a new todo..."
						className="w-full px-4 py-3 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
					/>
					<button
						disabled={todo.trim().length === 0}
						onClick={submitTodo}
						className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors"
					>
						Add todo
					</button>
				</div>
			</div>
		</div>
	);
}
