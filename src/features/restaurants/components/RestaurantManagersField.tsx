import { useClickOutside, useEscapeKey } from "@/global/hooks";
import { RestaurantsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE } from "convex/constants";
import { useConvexAuth } from "convex/react";
import { ChevronDown } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type DirectoryEntry = { userId: string; email: string | null };

function mergeDirectoryWithManagers(
	directory: DirectoryEntry[],
	members: Doc<"restaurantMembers">[],
): Array<{ userId: string; label: string }> {
	const labelByUser = new Map<string, string>();
	for (const d of directory) {
		labelByUser.set(d.userId, d.email && d.email.length > 0 ? d.email : d.userId);
	}
	for (const m of members) {
		if (m.isActive && m.role === RESTAURANT_MEMBER_ROLE.MANAGER && !labelByUser.has(m.userId)) {
			labelByUser.set(m.userId, m.userId);
		}
	}
	return [...labelByUser.entries()]
		.map(([userId, label]) => ({ userId, label }))
		.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export type RestaurantManagersFieldProps = {
	readonly restaurantId: Id<"restaurants">;
	readonly onError?: (message: string) => void;
};

export function RestaurantManagersField({
	restaurantId,
	onError,
}: Readonly<RestaurantManagersFieldProps>) {
	const { t } = useTranslation();
	const { isAuthenticated } = useConvexAuth();
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	const close = useCallback(() => setOpen(false), []);
	useClickOutside([triggerRef, panelRef], close, { enabled: open });
	useEscapeKey(close, { enabled: open });

	const membersQuery = useQuery({
		...convexQuery(api.restaurantMembers.listByRestaurant, { restaurantId }),
		enabled: isAuthenticated,
		select: unwrapResult<Doc<"restaurantMembers">[]>,
	});
	const directoryQuery = useQuery({
		...convexQuery(api.restaurantMembers.listOrganizationUsersForRestaurant, { restaurantId }),
		enabled: isAuthenticated,
		select: unwrapResult<DirectoryEntry[]>,
	});

	const members = membersQuery.data ?? [];
	const directory = directoryQuery.data ?? [];

	const options = useMemo(
		() => mergeDirectoryWithManagers(directory, members),
		[directory, members],
	);

	const selectedManagerUserIds = useMemo(
		() =>
			members
				.filter((m) => m.isActive && m.role === RESTAURANT_MEMBER_ROLE.MANAGER)
				.map((m) => m.userId),
		[members],
	);
	const selectedSet = useMemo(() => new Set(selectedManagerUserIds), [selectedManagerUserIds]);

	const summaryText = useMemo(
		() => t(RestaurantsKeys.MANAGERS_SUMMARY, { count: selectedManagerUserIds.length }),
		[selectedManagerUserIds.length, t],
	);

	const addMemberMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurantMembers.addMember),
	});
	const updateRoleMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurantMembers.updateRole),
	});

	const pending = addMemberMutation.isPending || updateRoleMutation.isPending;

	const runToggle = async (userId: string, makeManager: boolean) => {
		const member = members.find((m) => m.userId === userId);
		try {
			if (makeManager) {
				if (!member?.isActive) {
					unwrapResult(
						await addMemberMutation.mutateAsync({
							restaurantId,
							userId,
							role: RESTAURANT_MEMBER_ROLE.MANAGER,
						}),
					);
				} else if (member && member.role === RESTAURANT_MEMBER_ROLE.EMPLOYEE) {
					unwrapResult(
						await updateRoleMutation.mutateAsync({
							memberId: member._id,
							role: RESTAURANT_MEMBER_ROLE.MANAGER,
						}),
					);
				}
			} else if (member?.isActive && member?.role === RESTAURANT_MEMBER_ROLE.MANAGER) {
				unwrapResult(
					await updateRoleMutation.mutateAsync({
						memberId: member._id,
						role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
					}),
				);
			}
		} catch (e) {
			onError?.(e instanceof Error ? e.message : t(RestaurantsKeys.MANAGERS_MUTATION_FAILED));
		}
	};

	const toggle = (userId: string) => {
		const next = !selectedSet.has(userId);
		void runToggle(userId, next);
	};

	if (membersQuery.isError || directoryQuery.isError) {
		return null;
	}

	if (options.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
				{t(RestaurantsKeys.MANAGERS_EMPTY_DIRECTORY)}
			</div>
		);
	}

	const hasSelection = selectedManagerUserIds.length > 0;
	const triggerLabel = hasSelection ? summaryText : t(RestaurantsKeys.MANAGERS_PLACEHOLDER);

	return (
		<div className="relative space-y-2 max-w-lg">
			<div>
				<p className="text-sm font-medium text-foreground">{t(RestaurantsKeys.MANAGERS_SECTION_TITLE)}</p>
				<p className="text-xs text-muted-foreground mt-0.5">{t(RestaurantsKeys.MANAGERS_SECTION_HINT)}</p>
			</div>
			<button
				ref={triggerRef}
				type="button"
				disabled={pending}
				aria-expanded={open}
				aria-haspopup="listbox"
				aria-controls={listId}
				aria-label={t(RestaurantsKeys.MANAGERS_ARIA)}
				onClick={() => setOpen((o) => !o)}
				className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50"
			>
				<span className={hasSelection ? "truncate" : "truncate text-faint-foreground"}>{triggerLabel}</span>
				<ChevronDown className={`size-4 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
			</button>
			{open ? (
				<div
					ref={panelRef}
					id={listId}
					role="listbox"
					aria-multiselectable
					className="absolute z-50 mt-1 max-h-56 w-full max-w-lg overflow-y-auto rounded-md border border-border bg-card py-1 shadow-md"
				>
					{options.map((opt) => {
						const checked = selectedSet.has(opt.userId);
						return (
							<button
								key={opt.userId}
								type="button"
								role="option"
								aria-selected={checked}
								disabled={pending}
								onClick={() => toggle(opt.userId)}
								className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<span
									className="flex size-4 shrink-0 items-center justify-center rounded border border-border bg-background"
									aria-hidden
								>
									{checked ? <span className="text-primary text-xs font-bold">✓</span> : null}
								</span>
								<span className="truncate">{opt.label}</span>
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
