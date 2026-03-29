import { Modal, TextInput } from "@/global/components";
import { unwrapResult } from "@/global/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { OrganizationDoc } from "convex/constants";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

interface OrganizationFormDialogProps {
	isOpen: boolean;
	onClose: () => void;
	organization?: OrganizationDoc | null;
	onSuccess: () => void;
}

function parseFieldErrors(err: unknown): Record<string, string> | null {
	if (!(err instanceof Error) || !err.message.includes(":")) return null;
	const parts = err.message.split(", ");
	const errors: Record<string, string> = {};
	for (const part of parts) {
		const [field, ...msg] = part.split(": ");
		if (field && msg.length) {
			errors[field] = msg.join(": ");
		}
	}
	return Object.keys(errors).length > 0 ? errors : null;
}

export function OrganizationFormDialog({
	isOpen,
	onClose,
	organization,
	onSuccess,
}: Readonly<OrganizationFormDialogProps>) {
	const isEditing = !!organization;

	const [formError, setFormError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const createMutation = useMutation({
		mutationFn: useConvexMutation(api.organizations.createOrganization),
	});

	const updateMutation = useMutation({
		mutationFn: useConvexMutation(api.organizations.updateOrganization),
	});

	const isSubmitting = createMutation.isPending || updateMutation.isPending;

	const form = useForm({
		defaultValues: {
			name: organization?.name ?? "",
			slug: organization?.slug ?? "",
			description: organization?.description ?? "",
		},
		onSubmit: async ({ value }) => {
			setFormError(null);
			setFieldErrors({});

			try {
				const args = {
					name: value.name,
					slug: value.slug || undefined,
					description: value.description || undefined,
				};
				if (isEditing) {
					unwrapResult(await updateMutation.mutateAsync({ id: organization._id, ...args }));
				} else {
					unwrapResult(await createMutation.mutateAsync(args));
				}
				onSuccess();
				onClose();
			} catch (err) {
				const parsed = parseFieldErrors(err);
				if (parsed) {
					setFieldErrors(parsed);
					return;
				}
				setFormError(err instanceof Error ? err.message : "An error occurred");
			}
		},
	});

	useEffect(() => {
		if (isOpen) {
			form.reset({
				name: organization?.name ?? "",
				slug: organization?.slug ?? "",
				description: organization?.description ?? "",
			});
			setFormError(null);
			setFieldErrors({});
		}
	}, [isOpen, organization]);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={isEditing ? "Edit Organization" : "Create Organization"}
			size="md"
		>
			<div
				className="rounded-xl p-6"
				style={{
					backgroundColor: "var(--bg-primary)",
					border: "1px solid var(--border-default)",
				}}
			>
				<div className="flex items-center justify-between mb-6">
					<h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
						{isEditing ? "Edit Organization" : "Create Organization"}
					</h2>
					<button
						onClick={onClose}
						className="p-1 rounded-md transition-colors hover:opacity-80"
						style={{ color: "var(--text-muted)" }}
					>
						<X size={18} />
					</button>
				</div>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Field
						name="name"
						children={(field) => (
							<TextInput
								id="org-name"
								label="Name"
								placeholder="Organization name"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								error={fieldErrors.name}
								required
							/>
						)}
					/>
					<form.Field
						name="slug"
						children={(field) => (
							<TextInput
								id="org-slug"
								label="Slug (optional)"
								placeholder="organization-slug"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								error={fieldErrors.slug}
							/>
						)}
					/>
					<form.Field
						name="description"
						children={(field) => (
							<div>
								<label
									htmlFor="org-description"
									className="block text-xs font-medium mb-1"
									style={{ color: "var(--text-secondary)" }}
								>
									Description (optional)
								</label>
								<textarea
									id="org-description"
									placeholder="Brief description"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									rows={3}
									className="w-full px-3 py-2 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-(--btn-primary-bg) focus:border-transparent resize-none"
									style={{
										backgroundColor: "var(--bg-secondary)",
										border: "1px solid var(--border-default)",
										color: "var(--text-primary)",
									}}
								/>
							</div>
						)}
					/>

					{formError && (
						<p className="text-xs" style={{ color: "var(--accent-danger, #e53e3e)" }}>
							{formError}
						</p>
					)}

					<div className="flex justify-end gap-3 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2 rounded-lg text-sm transition-colors"
							style={{
								backgroundColor: "var(--bg-secondary)",
								color: "var(--text-primary)",
								border: "1px solid var(--border-default)",
							}}
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={isSubmitting}
							className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
							style={{
								backgroundColor: "var(--btn-primary-bg)",
								color: "var(--btn-primary-text)",
							}}
						>
							{isSubmitting && "Saving..."}
							{!isSubmitting && isEditing && "Save Changes"}
							{!isSubmitting && !isEditing && "Create"}
						</button>
					</div>
				</form>
			</div>
		</Modal>
	);
}
