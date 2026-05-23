/**
 * Lightweight modal: ask the user for a template name + optional description
 * and call the parent's `onSubmit` with the values. Submission errors are
 * surfaced inline.
 */
import { Modal } from "@/global/components";
import { DashboardKeys } from "@/global/i18n";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface PublishTemplateDialogProps {
	open: boolean;
	defaultName: string;
	onSubmit: (args: { name: string; description?: string }) => Promise<void>;
	onClose: () => void;
}

export function PublishTemplateDialog({
	open,
	defaultName,
	onSubmit,
	onClose,
}: PublishTemplateDialogProps) {
	const { t } = useTranslation();
	const [name, setName] = useState(defaultName);
	const [description, setDescription] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		setSubmitting(true);
		setError(null);
		try {
			await onSubmit({
				name: trimmed,
				description: description.trim() || undefined,
			});
			setName(defaultName);
			setDescription("");
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Modal isOpen={open} onClose={onClose} ariaLabel={t(DashboardKeys.TEMPLATES_PUBLISH)}>
			<div className="p-4 space-y-3">
				<h2 className="text-sm font-semibold text-foreground">
					{t(DashboardKeys.TEMPLATES_PUBLISH)}
				</h2>
				<label className="block text-xs">
					<span className="text-faint-foreground">
						{t(DashboardKeys.TEMPLATES_PUBLISH_NAME_LABEL)}
					</span>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="mt-1 w-full rounded border border-(--border-default) bg-background px-2 py-1.5 text-sm"
					/>
				</label>
				<label className="block text-xs">
					<span className="text-faint-foreground">
						{t(DashboardKeys.TEMPLATES_PUBLISH_DESCRIPTION_LABEL)}
					</span>
					<textarea
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						rows={3}
						className="mt-1 w-full rounded border border-(--border-default) bg-background px-2 py-1.5 text-sm"
					/>
				</label>
				{error && <p className="text-xs text-rose-500">{error}</p>}
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="text-xs px-2.5 py-1 rounded-md border border-(--border-default) hover:bg-(--bg-hover) text-foreground"
					>
						{t(DashboardKeys.PICKER_CLOSE)}
					</button>
					<button
						type="button"
						onClick={() => void handleSubmit()}
						disabled={submitting || !name.trim()}
						className="text-xs px-2.5 py-1 rounded-md bg-(--btn-primary-bg) text-(--btn-primary-text) disabled:opacity-50"
					>
						{t(DashboardKeys.TEMPLATES_PUBLISH_SAVE)}
					</button>
				</div>
			</div>
		</Modal>
	);
}
