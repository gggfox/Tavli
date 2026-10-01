import { Modal, TextInput } from "@/global/components";
import { OrganizationsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { useConvexMutation } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { OrganizationDoc } from "convex/constants";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface OrganizationFormDialogProps {
	isOpen: boolean;
	onClose: () => void;
	organization?: OrganizationDoc | null;
	onSuccess: () => void;
}

/**
 * The organization mutations name the failing field but word the reason in
 * English prose (`"name: An organization with this name already exists"`), so
 * the field is the only part worth reading: each one we know gets its own
 * localized hint, which covers every reason the backend has for that field.
 */
const FIELD_ERROR_KEYS: Record<string, string> = {
	name: OrganizationsKeys.FORM_NAME_INVALID,
	aiImageMonthlyLimit: OrganizationsKeys.FORM_AI_LIMIT_INVALID,
};

function parseFieldErrors(err: unknown): string[] | null {
	if (!(err instanceof Error) || !err.message.includes(":")) return null;
	const fields = err.message
		.split(", ")
		.map((part) => part.split(": ")[0])
		.filter((field) => field in FIELD_ERROR_KEYS);
	return fields.length > 0 ? fields : null;
}

export function OrganizationFormDialog({
	isOpen,
	onClose,
	organization,
	onSuccess,
}: Readonly<OrganizationFormDialogProps>) {
	const { t } = useTranslation();
	const isEditing = !!organization;

	const [formError, setFormError] = useState<string | null>(null);
	/** Field name → i18n key, translated at render so a language switch follows. */
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
			aiImageMonthlyLimit: String(organization?.aiImageMonthlyLimit ?? 100),
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
					// Only send the limit when it actually changed, and never send it
					// blank as `0`: a blank field means "leave it alone", not "turn
					// generation off".
					const loadedLimit = String(organization.aiImageMonthlyLimit ?? 100);
					const trimmedLimit = value.aiImageMonthlyLimit.trim();
					const limitChanged = value.aiImageMonthlyLimit !== loadedLimit && trimmedLimit !== "";
					unwrapResult(
						await updateMutation.mutateAsync({
							id: organization._id,
							...args,
							...(limitChanged ? { aiImageMonthlyLimit: Number(value.aiImageMonthlyLimit) } : {}),
						})
					);
				} else {
					unwrapResult(await createMutation.mutateAsync(args));
				}
				onSuccess();
				onClose();
			} catch (err) {
				const fields = parseFieldErrors(err);
				if (fields) {
					setFieldErrors(
						Object.fromEntries(fields.map((field) => [field, FIELD_ERROR_KEYS[field]]))
					);
					return;
				}
				setFormError(getErrorMessage(err, t, OrganizationsKeys.FORM_SAVE_FAILED));
			}
		},
	});

	useEffect(() => {
		if (isOpen) {
			form.reset({
				name: organization?.name ?? "",
				slug: organization?.slug ?? "",
				description: organization?.description ?? "",
				aiImageMonthlyLimit: String(organization?.aiImageMonthlyLimit ?? 100),
			});
			setFormError(null);
			setFieldErrors({});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- form.reset identity is stable; only re-run on open/organization change
	}, [isOpen, organization]);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={t(
				isEditing ? OrganizationsKeys.FORM_EDIT_TITLE : OrganizationsKeys.FORM_CREATE_TITLE
			)}
			size="md"
		>
			<div className="rounded-xl p-6 bg-background border border-border">
				<div className="flex items-center justify-between mb-6">
					<h2 className="text-lg font-semibold text-foreground">
						{t(isEditing ? OrganizationsKeys.FORM_EDIT_TITLE : OrganizationsKeys.FORM_CREATE_TITLE)}
					</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label={t(OrganizationsKeys.FORM_CLOSE)}
						className="p-1 rounded-md transition-colors hover:opacity-80 text-faint-foreground"
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
								label={t(OrganizationsKeys.FORM_NAME_LABEL)}
								placeholder={t(OrganizationsKeys.FORM_NAME_PLACEHOLDER)}
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								error={fieldErrors.name && t(fieldErrors.name)}
								required
							/>
						)}
					/>
					<form.Field
						name="slug"
						children={(field) => (
							<TextInput
								id="org-slug"
								label={t(OrganizationsKeys.FORM_SLUG_LABEL)}
								placeholder="organization-slug"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
							/>
						)}
					/>
					<form.Field
						name="description"
						children={(field) => (
							<div>
								<label
									htmlFor="org-description"
									className="block text-xs font-medium mb-1 text-muted-foreground"
								>
									{t(OrganizationsKeys.FORM_DESCRIPTION_LABEL)}
								</label>
								<textarea
									id="org-description"
									placeholder={t(OrganizationsKeys.FORM_DESCRIPTION_PLACEHOLDER)}
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									rows={3}
									className="w-full px-3 py-2 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-(--btn-primary-bg) focus:border-transparent resize-none bg-muted border border-border text-foreground"
								/>
							</div>
						)}
					/>
					<form.Field
						name="aiImageMonthlyLimit"
						children={(field) => (
							<TextInput
								id="org-ai-image-limit"
								type="number"
								min={0}
								step={1}
								label={t(OrganizationsKeys.FORM_AI_LIMIT_LABEL)}
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								error={fieldErrors.aiImageMonthlyLimit && t(fieldErrors.aiImageMonthlyLimit)}
							/>
						)}
					/>

					{formError && <p className="text-xs text-destructive">{formError}</p>}

					<div className="flex justify-end gap-3 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2 rounded-lg text-sm transition-colors bg-muted text-foreground border border-border"
						>
							{t(OrganizationsKeys.FORM_CANCEL)}
						</button>
						<button
							type="submit"
							disabled={isSubmitting}
							className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 bg-primary text-primary-foreground"
						>
							{isSubmitting && t(OrganizationsKeys.FORM_SAVING)}
							{!isSubmitting && isEditing && t(OrganizationsKeys.FORM_SAVE)}
							{!isSubmitting && !isEditing && t(OrganizationsKeys.FORM_CREATE)}
						</button>
					</div>
				</form>
			</div>
		</Modal>
	);
}
