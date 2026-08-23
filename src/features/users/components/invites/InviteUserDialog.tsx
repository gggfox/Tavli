/**
 * Invite one person into any organization on the platform.
 *
 * This is the admin sibling of the team tab's invite drawer. The team tab is
 * scoped to the restaurant the operator is already in; this one is scoped to
 * nothing, which is exactly what makes it dangerous — inviting somebody who
 * already belongs to another organization would MOVE them out of it when they
 * accept (`acceptInvitation` overwrites `userRoles.organizationId`). So the
 * cross-organization case is treated as a first-class state, not an error:
 * the backend refuses, the form explains what would happen in plain words, and
 * only an explicitly ticked acknowledgement re-enables Send.
 *
 * No account is created here and no Personal PIN is ever minted — managed
 * employee accounts (ADR 006) remain a manager-only, one-at-a-time flow in the
 * team tab. An employee invited here is a normal Clerk-backed user.
 */
import { DialogHeader, Modal } from "@/global/components";
import { RestaurantInviteMultiSelect } from "@/features/team/components/RestaurantInviteMultiSelect";
import { UserOnboardingKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "convex/constants";
import {
	INVITE_OVERRIDE,
	INVITE_ROW_STATUS,
	type InviteOverride,
	type InviteRole,
} from "convex/inviteOnboardingHelpers";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useCallback, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminInvite } from "../../hooks/useAdminInvite";
import { useInviteDirectory } from "../../hooks/useInviteDirectory";
import { inviteReasonKey, OVERRIDE_COPY } from "../../utils/inviteVerdicts";

const INVITE_ROLES: readonly InviteRole[] = [
	USER_ROLES.OWNER,
	RESTAURANT_MEMBER_ROLE.MANAGER,
	RESTAURANT_MEMBER_ROLE.EMPLOYEE,
];

const ROLE_LABEL_KEYS: Readonly<Record<InviteRole, string>> = {
	[USER_ROLES.OWNER]: UserOnboardingKeys.ROLE_OWNER,
	[RESTAURANT_MEMBER_ROLE.MANAGER]: UserOnboardingKeys.ROLE_MANAGER,
	[RESTAURANT_MEMBER_ROLE.EMPLOYEE]: UserOnboardingKeys.ROLE_EMPLOYEE,
};

const FIELD_CLASS =
	"mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50";

export interface InviteUserDialogProps {
	readonly isOpen: boolean;
	readonly onClose: () => void;
}

interface SentState {
	readonly email: string;
	readonly status: string;
	readonly replacedPendingCount: number;
}

export function InviteUserDialog({ isOpen, onClose }: Readonly<InviteUserDialogProps>) {
	const { t } = useTranslation();
	const fieldPrefix = useId();

	const [email, setEmail] = useState("");
	const [role, setRole] = useState<InviteRole>(USER_ROLES.OWNER);
	const [organizationId, setOrganizationId] = useState<Id<"organizations"> | null>(null);
	const [restaurantIds, setRestaurantIds] = useState<Id<"restaurants">[]>([]);
	const [firstName, setFirstName] = useState("");
	const [paternalLastname, setPaternalLastname] = useState("");
	const [maternalLastname, setMaternalLastname] = useState("");

	/** Acknowledgements the backend has demanded for the invitation as it stands. */
	const [demanded, setDemanded] = useState<InviteOverride[]>([]);
	const [acknowledged, setAcknowledged] = useState<InviteOverride[]>([]);
	const [errorCode, setErrorCode] = useState<string | null>(null);
	const [sent, setSent] = useState<SentState | null>(null);

	const {
		organizations,
		isOrganizationsLoading,
		organizationsError,
		restaurants,
		isRestaurantsLoading,
		restaurantsError,
	} = useInviteDirectory({ enabled: isOpen, organizationId });

	const { send, isSending } = useAdminInvite();

	/**
	 * Any edit invalidates a verdict the backend gave about the PREVIOUS values.
	 * Keeping a tick alive across an email change is how somebody gets moved
	 * between organizations without anyone meaning it.
	 */
	const invalidateVerdict = useCallback(() => {
		setDemanded([]);
		setAcknowledged([]);
		setErrorCode(null);
	}, []);

	const resetForm = useCallback(() => {
		setEmail("");
		setRole(USER_ROLES.OWNER);
		setOrganizationId(null);
		setRestaurantIds([]);
		setFirstName("");
		setPaternalLastname("");
		setMaternalLastname("");
		setSent(null);
		invalidateVerdict();
	}, [invalidateVerdict]);

	const handleClose = useCallback(() => {
		resetForm();
		onClose();
	}, [resetForm, onClose]);

	const handleOrganizationChange = useCallback(
		(next: string) => {
			setOrganizationId(next.length > 0 ? (next as Id<"organizations">) : null);
			// A restaurant from the previous organization must never survive into
			// the submitted payload — the backend would reject it, but a UI that
			// shows a stale selection has already misled the admin.
			setRestaurantIds([]);
			invalidateVerdict();
		},
		[invalidateVerdict]
	);

	const handleRoleChange = useCallback(
		(next: InviteRole) => {
			setRole(next);
			if (next === USER_ROLES.OWNER) setRestaurantIds([]);
			invalidateVerdict();
		},
		[invalidateVerdict]
	);

	const handleRestaurantsChange = useCallback(
		(next: Id<"restaurants">[]) => {
			setRestaurantIds(next);
			invalidateVerdict();
		},
		[invalidateVerdict]
	);

	const toggleAcknowledgement = useCallback((override: InviteOverride) => {
		setAcknowledged((current) =>
			current.includes(override)
				? current.filter((value) => value !== override)
				: [...current, override]
		);
	}, []);

	const needsRestaurants = role !== USER_ROLES.OWNER;
	const restaurantOptions = useMemo(
		() => restaurants.map((restaurant) => ({ id: restaurant._id, label: restaurant.name })),
		[restaurants]
	);

	const unacknowledged = demanded.filter((override) => !acknowledged.includes(override));

	const canSend =
		!isSending &&
		email.trim().length > 0 &&
		organizationId !== null &&
		(!needsRestaurants || restaurantIds.length > 0) &&
		unacknowledged.length === 0;

	const handleSend = useCallback(async () => {
		if (organizationId === null) return;

		const outcome = await send({
			email: email.trim(),
			role,
			organizationId,
			restaurantIds: needsRestaurants ? restaurantIds : [],
			...(firstName.trim() && { firstName: firstName.trim() }),
			...(paternalLastname.trim() && { paternalLastname: paternalLastname.trim() }),
			...(maternalLastname.trim() && { maternalLastname: maternalLastname.trim() }),
			acknowledgeOrgMove: acknowledged.includes(INVITE_OVERRIDE.ACKNOWLEDGE_ORG_MOVE),
			replaceExistingPending: acknowledged.includes(INVITE_OVERRIDE.REPLACE_EXISTING_PENDING),
		});

		if (outcome.kind === "sent") {
			setSent({
				email: email.trim().toLowerCase(),
				status: outcome.status,
				replacedPendingCount: outcome.replacedPendingCount,
			});
			return;
		}

		if (outcome.kind === "needs_acknowledgement") {
			setErrorCode(null);
			setDemanded((current) =>
				current.includes(outcome.override) ? current : [...current, outcome.override]
			);
			return;
		}

		setErrorCode(outcome.code);
	}, [
		organizationId,
		send,
		email,
		role,
		needsRestaurants,
		restaurantIds,
		firstName,
		paternalLastname,
		maternalLastname,
		acknowledged,
	]);

	const handleInviteAnother = useCallback(() => {
		resetForm();
	}, [resetForm]);

	return (
		<Modal
			isOpen={isOpen}
			onClose={handleClose}
			ariaLabel={t(UserOnboardingKeys.SINGLE_TITLE)}
			size="lg"
		>
			<div className="bg-background border border-border rounded-xl flex flex-col max-h-[85vh] overflow-hidden">
				<DialogHeader
					title={t(UserOnboardingKeys.SINGLE_TITLE)}
					subtitle={sent ? undefined : t(UserOnboardingKeys.SINGLE_SUBTITLE)}
					onClose={handleClose}
					closeAriaLabel={t(UserOnboardingKeys.CLOSE)}
				/>

				{sent ? (
					<>
						<div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-3">
							<div className="flex items-start gap-3">
								<CheckCircle2 className="mt-0.5 shrink-0 text-success" size={20} aria-hidden />
								<div className="space-y-1">
									<p className="text-sm font-medium text-foreground">
										{t(UserOnboardingKeys.SINGLE_SUCCESS_TITLE)}
									</p>
									<p className="text-sm text-muted-foreground">
										{t(UserOnboardingKeys.SINGLE_SUCCESS_BODY, { email: sent.email })}
									</p>
									{sent.status === INVITE_ROW_STATUS.ALREADY_MEMBER && (
										<p className="text-sm text-muted-foreground">
											{t(UserOnboardingKeys.SINGLE_SUCCESS_ALREADY_MEMBER)}
										</p>
									)}
									{sent.replacedPendingCount > 0 && (
										<p className="text-sm text-muted-foreground">
											{t(UserOnboardingKeys.SINGLE_SUCCESS_REPLACED)}
										</p>
									)}
								</div>
							</div>
						</div>
						<div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
							<button
								type="button"
								onClick={handleInviteAnother}
								className="text-sm font-medium px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-hover"
							>
								{t(UserOnboardingKeys.SINGLE_INVITE_ANOTHER)}
							</button>
							<button
								type="button"
								onClick={handleClose}
								className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
							>
								{t(UserOnboardingKeys.DONE)}
							</button>
						</div>
					</>
				) : (
					<>
						<div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
							<div>
								<label
									htmlFor={`${fieldPrefix}-email`}
									className="block text-xs text-faint-foreground"
								>
									{t(UserOnboardingKeys.EMAIL_LABEL)}
								</label>
								<input
									id={`${fieldPrefix}-email`}
									className={FIELD_CLASS}
									type="email"
									autoComplete="email"
									value={email}
									onChange={(event) => {
										setEmail(event.target.value);
										invalidateVerdict();
									}}
								/>
								<p className="mt-1 text-xs text-muted-foreground">
									{t(UserOnboardingKeys.EMAIL_HINT)}
								</p>
							</div>

							<div>
								<label
									htmlFor={`${fieldPrefix}-role`}
									className="block text-xs text-faint-foreground"
								>
									{t(UserOnboardingKeys.ROLE_LABEL)}
								</label>
								<select
									id={`${fieldPrefix}-role`}
									className={FIELD_CLASS}
									value={role}
									onChange={(event) => handleRoleChange(event.target.value as InviteRole)}
								>
									{INVITE_ROLES.map((option) => (
										<option key={option} value={option}>
											{t(ROLE_LABEL_KEYS[option])}
										</option>
									))}
								</select>
							</div>

							<div>
								<label
									htmlFor={`${fieldPrefix}-organization`}
									className="block text-xs text-faint-foreground"
								>
									{t(UserOnboardingKeys.ORGANIZATION_LABEL)}
								</label>
								<select
									id={`${fieldPrefix}-organization`}
									className={FIELD_CLASS}
									value={organizationId ?? ""}
									disabled={isOrganizationsLoading || organizations.length === 0}
									onChange={(event) => handleOrganizationChange(event.target.value)}
								>
									<option value="">{t(UserOnboardingKeys.ORGANIZATION_PLACEHOLDER)}</option>
									{organizations.map((organization) => (
										<option key={organization._id} value={organization._id}>
											{organization.name}
										</option>
									))}
								</select>
							</div>
							{isOrganizationsLoading && (
								<p className="text-xs text-muted-foreground">
									{t(UserOnboardingKeys.ORGANIZATION_LOADING)}
								</p>
							)}
							{!isOrganizationsLoading && organizationsError != null && (
								<p className="text-xs text-destructive">
									{t(UserOnboardingKeys.ORGANIZATION_ERROR)}
								</p>
							)}
							{!isOrganizationsLoading &&
								organizationsError == null &&
								organizations.length === 0 && (
									<p className="text-xs text-muted-foreground">
										{t(UserOnboardingKeys.ORGANIZATION_EMPTY)}
									</p>
								)}

							{needsRestaurants && (
								<div className="text-xs text-faint-foreground">
									<span className="font-medium text-foreground">
										{t(UserOnboardingKeys.RESTAURANTS_LABEL)}
									</span>
									<RestaurantInviteMultiSelect
										options={restaurantOptions}
										selectedIds={restaurantIds}
										onChange={handleRestaurantsChange}
										placeholder={t(UserOnboardingKeys.RESTAURANTS_PLACEHOLDER)}
										summaryText={t(UserOnboardingKeys.RESTAURANTS_SUMMARY, {
											count: restaurantIds.length,
										})}
										ariaLabel={t(UserOnboardingKeys.RESTAURANTS_ARIA)}
										disabled={isSending || isRestaurantsLoading}
									/>
									{organizationId === null ? (
										<p className="mt-1 text-xs text-muted-foreground">
											{t(UserOnboardingKeys.RESTAURANTS_PICK_ORGANIZATION)}
										</p>
									) : isRestaurantsLoading ? (
										<p className="mt-1 text-xs text-muted-foreground">
											{t(UserOnboardingKeys.RESTAURANTS_LOADING)}
										</p>
									) : restaurantsError != null ? (
										<p className="mt-1 text-xs text-destructive">
											{t(UserOnboardingKeys.RESTAURANTS_ERROR)}
										</p>
									) : restaurantOptions.length === 0 ? (
										<p className="mt-1 text-xs text-muted-foreground">
											{t(UserOnboardingKeys.RESTAURANTS_EMPTY)}
										</p>
									) : (
										<p className="mt-1 text-xs text-muted-foreground">
											{t(UserOnboardingKeys.RESTAURANTS_REQUIRED_HINT)}
										</p>
									)}
								</div>
							)}

							<fieldset className="space-y-2">
								<legend className="text-xs font-medium text-foreground">
									{t(UserOnboardingKeys.NAMES_SECTION)}
								</legend>
								<label className="block text-xs text-faint-foreground">
									{t(UserOnboardingKeys.FIRST_NAME_LABEL)}
									<input
										className={FIELD_CLASS}
										value={firstName}
										onChange={(event) => setFirstName(event.target.value)}
									/>
								</label>
								<label className="block text-xs text-faint-foreground">
									{t(UserOnboardingKeys.PATERNAL_LASTNAME_LABEL)}
									<input
										className={FIELD_CLASS}
										value={paternalLastname}
										onChange={(event) => setPaternalLastname(event.target.value)}
									/>
								</label>
								<label className="block text-xs text-faint-foreground">
									{t(UserOnboardingKeys.MATERNAL_LASTNAME_LABEL)}
									<input
										className={FIELD_CLASS}
										value={maternalLastname}
										onChange={(event) => setMaternalLastname(event.target.value)}
									/>
								</label>
							</fieldset>

							{demanded.map((override) => {
								const copy = OVERRIDE_COPY[override];
								return (
									<div
										key={override}
										className="rounded-md border border-warning/40 bg-warning-subtle p-3 space-y-2"
									>
										<div className="flex items-start gap-2">
											<AlertTriangle
												className="mt-0.5 shrink-0 text-warning"
												size={16}
												aria-hidden
											/>
											<div className="space-y-1">
												<p className="text-sm font-medium text-foreground">{t(copy.titleKey)}</p>
												<p className="text-xs text-muted-foreground">{t(copy.bodyKey)}</p>
											</div>
										</div>
										<label className="flex items-start gap-2 text-xs text-foreground">
											<input
												type="checkbox"
												className="mt-0.5"
												checked={acknowledged.includes(override)}
												onChange={() => toggleAcknowledgement(override)}
											/>
											<span>{t(copy.acknowledgeKey)}</span>
										</label>
									</div>
								);
							})}

							{errorCode !== null && (
								<p className="text-sm text-destructive">{t(inviteReasonKey(errorCode))}</p>
							)}
						</div>

						<div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
							<button
								type="button"
								onClick={handleClose}
								className="text-sm font-medium px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-hover"
							>
								{t(UserOnboardingKeys.CANCEL)}
							</button>
							<button
								type="button"
								onClick={() => void handleSend()}
								disabled={!canSend}
								className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
							>
								{isSending ? t(UserOnboardingKeys.SENDING) : t(UserOnboardingKeys.SEND)}
							</button>
						</div>
					</>
				)}
			</div>
		</Modal>
	);
}
