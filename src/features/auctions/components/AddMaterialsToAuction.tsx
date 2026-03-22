/**
 * AddMaterialsToAuction - Component for adding approved materials to the live auction
 *
 * Allows admins and sellers to:
 * - View approved materials (sellers see their own, admins see all)
 * - Add materials to the current live auction
 * - Create new materials that match the full schema
 * - See which materials are already in the auction
 */
import { Modal } from "@/global";
import { MultiCardSelect } from "@/global/components";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { useConvex, useConvexAuth, useMutation as useConvexMutation } from "convex/react";
import {
	AlertCircle,
	CheckCircle2,
	ListPlus,
	Loader2,
	Package,
	Plus,
	Search,
	X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

// Default location used when the location feature flag is disabled
const DEFAULT_LOCATION = "Main Warehouse";

import { Id } from "convex/_generated/dataModel";
import type { CategoryId, MaterialDoc } from "convex/constants";

type Material = MaterialDoc;

type TabType = "add-existing" | "create-new";

// Common units for steel/metal materials
interface UnitOption {
	value: string;
	label: string;
	baseUnit: string;
	conversionFactor: number;
}

const COMMON_UNITS: UnitOption[] = [
	{ value: "kg", label: "Kilograms (kg)", baseUnit: "kg", conversionFactor: 1 },
	{ value: "ton", label: "Metric Tons (ton)", baseUnit: "kg", conversionFactor: 1000 },
	{ value: "lb", label: "Pounds (lb)", baseUnit: "kg", conversionFactor: 0.453592 },
	{ value: "pcs", label: "Pieces (pcs)", baseUnit: "pcs", conversionFactor: 1 },
	{ value: "m", label: "Meters (m)", baseUnit: "m", conversionFactor: 1 },
	{ value: "ft", label: "Feet (ft)", baseUnit: "m", conversionFactor: 0.3048 },
];

function formatQuantity(normalizedQuantity: {
	quantity: number;
	unit: string;
	baseUnit: string;
	baseQuantity: number;
}): string {
	return `${normalizedQuantity.quantity} ${normalizedQuantity.unit}`;
}

// ============================================================================
// Material Row Component
// ============================================================================
function MaterialRow({
	material,
	isInAuction,
	onAdd,
	isAdding,
}: Readonly<{
	material: Material;
	isInAuction: boolean;
	onAdd: () => Promise<void>;
	isAdding: boolean;
}>) {
	return (
		<div
			className="flex items-center justify-between p-3 rounded-md border transition-colors"
			style={{
				backgroundColor: "var(--bg-primary)",
				borderColor: "var(--border-default)",
			}}
		>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2 mb-1">
					<span className="font-mono text-xs font-medium" style={{ color: "var(--text-primary)" }}>
						{material.materialId}
					</span>
					{isInAuction && (
						<span
							className="px-2 py-0.5 rounded-full text-xs font-medium"
							style={{
								backgroundColor: "rgba(34, 197, 94, 0.15)",
								color: "rgb(34, 197, 94)",
							}}
						>
							In Auction
						</span>
					)}
				</div>
				<div className="text-sm" style={{ color: "var(--text-secondary)" }}>
					{material.location} • {formatQuantity(material.normalizedQuantity)}
				</div>
			</div>
			<div className="ml-4">
				{isInAuction ? (
					<span className="text-xs" style={{ color: "var(--text-muted)" }}>
						Already added
					</span>
				) : (
					<button
						type="button"
						onClick={onAdd}
						disabled={isAdding}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80"
						style={{
							backgroundColor: "rgb(59, 130, 246)",
							color: "white",
						}}
					>
						{isAdding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
						<span>Add</span>
					</button>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Submit Button Content Helper
// ============================================================================
function SubmitButtonContent({
	isSubmitting,
	success,
}: Readonly<{ isSubmitting: boolean; success: boolean }>) {
	if (isSubmitting) {
		return (
			<>
				<Loader2 size={16} className="animate-spin" />
				<span>Creating...</span>
			</>
		);
	}
	if (success) {
		return (
			<>
				<CheckCircle2 size={16} />
				<span>Created!</span>
			</>
		);
	}
	return (
		<>
			<Plus size={16} />
			<span>Create Material</span>
		</>
	);
}

// ============================================================================
// Create Material Form
// ============================================================================
function CreateMaterialForm({
	onSuccess,
	onCancel,
}: Readonly<{
	onSuccess: () => void;
	onCancel: () => void;
}>) {
	const { t } = useTranslation();
	const { isAuthenticated } = useConvexAuth();
	const queryClient = useQueryClient();
	const createMaterial = useConvexMutation(api.materials.createMaterial);

	// Form state
	const [categoryIds, setCategoryIds] = useState<CategoryId[]>([]);
	const [formIds, setFormIds] = useState<Id<"forms">[]>([]);
	const [finishIds, setFinishIds] = useState<Id<"finishes">[]>([]);
	const [choiceIds, setChoiceIds] = useState<Id<"choices">[]>([]);
	const [quantity, setQuantity] = useState("");
	const [selectedUnit, setSelectedUnit] = useState(COMMON_UNITS[0]);
	const [location, setLocation] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	// Fetch reference data
	const { data: categories = [], isLoading: isLoadingCategories } = useQuery({
		...convexQuery(api.materials.getCategories, {}),
		enabled: isAuthenticated,
	});

	const { data: forms = [], isLoading: isLoadingForms } = useQuery({
		...convexQuery(api.materials.getForms, {}),
		enabled: isAuthenticated,
	});

	const { data: finishes = [], isLoading: isLoadingFinishes } = useQuery({
		...convexQuery(api.materials.getFinishes, {}),
		enabled: isAuthenticated,
	});

	const { data: choices = [], isLoading: isLoadingChoices } = useQuery({
		...convexQuery(api.materials.getChoices, {}),
		enabled: isAuthenticated,
	});

	// Feature flag for location field
	const { data: isLocationEnabled = false } = useQuery({
		...convexQuery(api.featureFlags.isFeatureEnabled, { key: "material_location" }),
		enabled: isAuthenticated,
	});

	const isLoadingReferenceData =
		isLoadingCategories || isLoadingForms || isLoadingFinishes || isLoadingChoices;

	// Calculate base quantity
	const normalizedQuantity = useMemo(() => {
		const qty = Number.parseFloat(quantity) || 0;
		return {
			quantity: qty,
			unit: selectedUnit.value,
			baseUnit: selectedUnit.baseUnit,
			baseQuantity: qty * selectedUnit.conversionFactor,
		};
	}, [quantity, selectedUnit]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		// Validation
		if (categoryIds.length === 0) {
			setError(t("errors.validation.categoryRequired"));
			return;
		}

		if (!quantity || Number.parseFloat(quantity) <= 0) {
			setError(t("errors.validation.quantityRequired"));
			return;
		}

		// Only validate location if the feature flag is enabled
		if (isLocationEnabled && !location.trim()) {
			setError(t("errors.validation.locationRequired"));
			return;
		}

		setIsSubmitting(true);

		try {
			await createMaterial({
				categoryIds,
				formIds: formIds.length > 0 ? formIds : undefined,
				finishIds: finishIds.length > 0 ? finishIds : undefined,
				choiceIds: choiceIds.length > 0 ? choiceIds : undefined,
				normalizedQuantity,
				location: isLocationEnabled ? location.trim() : DEFAULT_LOCATION,
			});

			setSuccess(true);

			// Invalidate queries to refresh the materials list
			await queryClient.invalidateQueries({ queryKey: ["materials"] });

			// Reset form after short delay
			setTimeout(() => {
				setCategoryIds([]);
				setFormIds([]);
				setFinishIds([]);
				setChoiceIds([]);
				setQuantity("");
				setSelectedUnit(COMMON_UNITS[0]);
				setLocation("");
				setSuccess(false);
				onSuccess();
			}, 1500);
		} finally {
			setIsSubmitting(false);
		}
	};

	if (isLoadingReferenceData) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-5">
			{/* Error/Success messages */}
			{error && (
				<div
					className="flex items-center gap-2 p-3 rounded-lg text-sm"
					style={{
						backgroundColor: "rgba(239, 68, 68, 0.1)",
						color: "rgb(239, 68, 68)",
					}}
				>
					<AlertCircle size={16} />
					<span>{error}</span>
				</div>
			)}

			{success && (
				<div
					className="flex items-center gap-2 p-3 rounded-lg text-sm"
					style={{
						backgroundColor: "rgba(34, 197, 94, 0.1)",
						color: "rgb(34, 197, 94)",
					}}
				>
					<CheckCircle2 size={16} />
					<span>{t("errors.materials.createSuccess")}</span>
				</div>
			)}

			{/* Category Selection - Required */}
			<MultiCardSelect
				label="Categories"
				options={categories}
				selectedIds={categoryIds}
				onChange={(ids) => setCategoryIds(ids as CategoryId[])}
				placeholder="Select material categories..."
				required
				groupBy={(cat) => cat.groupTitle}
			/>

			{/* Form Selection - Optional */}
			<MultiCardSelect
				label="Forms"
				options={forms}
				selectedIds={formIds}
				onChange={(ids) => setFormIds(ids as Id<"forms">[])}
				placeholder="Select product forms..."
			/>

			{/* Finish Selection - Optional */}
			<MultiCardSelect
				label="Finishes"
				options={finishes}
				selectedIds={finishIds}
				onChange={(ids) => setFinishIds(ids as Id<"finishes">[])}
				placeholder="Select material finishes..."
			/>

			{/* Choice Selection - Optional */}
			<MultiCardSelect
				label="Choices"
				options={choices}
				selectedIds={choiceIds}
				onChange={(ids) => setChoiceIds(ids as Id<"choices">[])}
				placeholder="Select quality choices..."
			/>

			{/* Quantity and Unit */}
			<div className="grid grid-cols-2 gap-4">
				<div>
					<label
						htmlFor="material-quantity"
						className="block text-sm font-medium mb-1.5"
						style={{ color: "var(--text-secondary)" }}
					>
						Quantity<span className="text-red-400 ml-1">*</span>
					</label>
					<input
						id="material-quantity"
						type="number"
						value={quantity}
						onChange={(e) => setQuantity(e.target.value)}
						placeholder="Enter quantity"
						min="1"
						step="1"
						className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 number-input"
						style={{
							backgroundColor: "var(--bg-primary)",
							color: "var(--text-primary)",
							border: "1px solid var(--border-default)",
						}}
					/>
				</div>

				<div>
					<label
						htmlFor="material-unit"
						className="block text-sm font-medium mb-1.5"
						style={{ color: "var(--text-secondary)" }}
					>
						Unit<span className="text-red-400 ml-1">*</span>
					</label>
					<select
						id="material-unit"
						value={selectedUnit.value}
						onChange={(e) => {
							const unit = COMMON_UNITS.find((u) => u.value === e.target.value);
							if (unit) setSelectedUnit(unit);
						}}
						className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
						style={{
							backgroundColor: "var(--bg-primary)",
							color: "var(--text-primary)",
							border: "1px solid var(--border-default)",
						}}
					>
						{COMMON_UNITS.map((unit) => (
							<option key={unit.value} value={unit.value}>
								{unit.label}
							</option>
						))}
					</select>
				</div>
			</div>

			{/* Normalized quantity preview */}
			{quantity && Number.parseFloat(quantity) > 0 && (
				<div
					className="px-3 py-2 rounded-lg text-xs"
					style={{
						backgroundColor: "var(--bg-tertiary)",
						color: "var(--text-muted)",
					}}
				>
					Base quantity: {normalizedQuantity.baseQuantity.toFixed(2)} {normalizedQuantity.baseUnit}
				</div>
			)}

			{/* Location - only shown when feature flag is enabled */}
			{isLocationEnabled && (
				<div>
					<label
						htmlFor="material-location"
						className="block text-sm font-medium mb-1.5"
						style={{ color: "var(--text-secondary)" }}
					>
						Location<span className="text-red-400 ml-1">*</span>
					</label>
					<input
						id="material-location"
						type="text"
						value={location}
						onChange={(e) => setLocation(e.target.value)}
						placeholder="e.g., Warehouse A, Mexico City"
						className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
						style={{
							backgroundColor: "var(--bg-primary)",
							color: "var(--text-primary)",
							border: "1px solid var(--border-default)",
						}}
					/>
				</div>
			)}

			{/* Action buttons */}
			<div className="flex items-center justify-end gap-3 pt-2">
				<button
					type="button"
					onClick={onCancel}
					disabled={isSubmitting}
					className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80 disabled:opacity-50"
					style={{
						backgroundColor: "var(--bg-tertiary)",
						color: "var(--text-secondary)",
					}}
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={isSubmitting || success}
					className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
					style={{
						backgroundColor: "rgb(59, 130, 246)",
						color: "white",
					}}
				>
					<SubmitButtonContent isSubmitting={isSubmitting} success={success} />
				</button>
			</div>
		</form>
	);
}

// ============================================================================
// Add Existing Materials Tab Content
// ============================================================================
function AddExistingMaterialsContent() {
	const { t } = useTranslation();
	const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
	const client = useConvex();
	const [searchText, setSearchText] = useState("");
	const [addingMaterials, setAddingMaterials] = useState<Set<string>>(new Set());
	const [successMessages, setSuccessMessages] = useState<
		Map<string, { message: string; isSuccess: boolean }>
	>(new Map());

	// Get user roles
	// Extract the first element from the tuple [data, error] returned by AsyncReturn
	const { data: rawUserRoles } = useQuery({
		...convexQuery(api.admin.getCurrentUserRoles, {}),
		enabled: isAuthenticated,
	});
	const userRoles: string[] = useMemo(
		() => (Array.isArray(rawUserRoles) && rawUserRoles[0] !== null ? rawUserRoles[0] : []),
		[rawUserRoles]
	);

	const isAdmin = useMemo(() => userRoles.includes("admin"), [userRoles]);

	// Get live auction data using the regular query (not suspense)
	// This avoids the useAuctions() hook which uses useSuspenseQuery
	const { data: rawLiveAuctionData } = useQuery({
		...convexQuery(api.auctions.getLiveAuction, {}),
		enabled: isAuthenticated,
	});
	// Extract live auction from AsyncReturn tuple [data, error]
	const liveAuction = useMemo(
		() =>
			Array.isArray(rawLiveAuctionData) && rawLiveAuctionData[0] ? rawLiveAuctionData[0] : null,
		[rawLiveAuctionData]
	);

	// Get approved materials
	const { data: approvedMaterials = [], isLoading: isLoadingMaterials } = useQuery({
		...convexQuery(
			isAdmin ? api.materials.getMaterialsByStatus : api.materials.getSellerMaterials,
			isAdmin ? { status: "approved" } : {}
		),
		enabled: isAuthenticated,
	});

	// Get materials already in the live auction
	const { data: liveAuctionMaterials, refetch: refetchLiveAuctionMaterials } = useQuery({
		...convexQuery(api.materials.getLiveAuctionMaterials, {}),
		enabled: isAuthenticated && !!liveAuction,
	});
	const materialsInAuction = useMemo(() => {
		if (!liveAuctionMaterials?.materials) {
			return new Set<string>();
		}
		return new Set(
			liveAuctionMaterials.materials.map((item) => item.material.materialId).filter(Boolean)
		);
	}, [liveAuctionMaterials]);

	const filteredMaterials = useMemo(() => {
		// For sellers, only show their approved materials
		const materialsToFilter = isAdmin
			? approvedMaterials
			: approvedMaterials.filter((m) => m.status === "approved");

		if (!searchText.trim()) return materialsToFilter;

		const searchLower = searchText.toLowerCase();
		return materialsToFilter.filter(
			(material) =>
				material.materialId.toLowerCase().includes(searchLower) ||
				material.location.toLowerCase().includes(searchLower) ||
				material.searchableText.toLowerCase().includes(searchLower)
		);
	}, [approvedMaterials, searchText, isAdmin]);

	// Add material to live auction using direct Convex client
	// This avoids the useAuctions() hook which uses useSuspenseQuery
	const handleAddMaterial = useCallback(
		async (materialId: string) => {
			if (!liveAuction) return;

			setAddingMaterials((prev) => new Set(prev).add(materialId));
			setSuccessMessages((prev) => {
				const next = new Map(prev);
				next.delete(materialId);
				return next;
			});

			try {
				const [, error] = await client.mutation(api.materials.addMaterialToLiveAuction, {
					materialId,
				});

				if (!error) {
					await refetchLiveAuctionMaterials();
					setSuccessMessages((prev) =>
						new Map(prev).set(materialId, {
							message: t("errors.materials.addToAuctionSuccess"),
							isSuccess: true,
						})
					);
					setTimeout(() => {
						setSuccessMessages((prev) => {
							const next = new Map(prev);
							next.delete(materialId);
							return next;
						});
					}, 3000);
				}
			} finally {
				setAddingMaterials((prev) => {
					const next = new Set(prev);
					next.delete(materialId);
					return next;
				});
			}
		},
		[liveAuction, client, refetchLiveAuctionMaterials, t]
	);

	if (isAuthLoading || isLoadingMaterials) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
			</div>
		);
	}

	if (!liveAuction) {
		return (
			<div
				className="flex items-center gap-2 p-4 rounded-lg"
				style={{ backgroundColor: "rgba(234, 179, 8, 0.1)" }}
			>
				<AlertCircle size={16} style={{ color: "rgb(234, 179, 8)" }} />
				<span className="text-sm" style={{ color: "var(--text-secondary)" }}>
					No live auction available. Materials can only be added when there is an active auction.
				</span>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Search */}
			<div className="relative">
				<Search
					size={16}
					className="absolute left-3 top-1/2 -translate-y-1/2"
					style={{ color: "var(--text-muted)" }}
				/>
				<input
					type="text"
					placeholder="Search materials..."
					value={searchText}
					onChange={(e) => setSearchText(e.target.value)}
					className="w-full pl-9 pr-9 py-2.5 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
					style={{
						backgroundColor: "var(--bg-primary)",
						color: "var(--text-primary)",
						border: "1px solid var(--border-default)",
					}}
				/>
				{searchText && (
					<button
						type="button"
						onClick={() => setSearchText("")}
						className="absolute right-3 top-1/2 -translate-y-1/2"
						style={{ color: "var(--text-muted)" }}
					>
						<X size={16} />
					</button>
				)}
			</div>

			{/* Materials List */}
			<div className="max-h-80 overflow-y-auto">
				{filteredMaterials.length === 0 ? (
					<div
						className="p-6 rounded-lg text-center"
						style={{
							backgroundColor: "var(--bg-primary)",
							border: "1px solid var(--border-default)",
						}}
					>
						<Package size={32} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
						<p className="text-sm" style={{ color: "var(--text-secondary)" }}>
							{searchText
								? "No materials found matching your search."
								: "No approved materials available to add."}
						</p>
						<p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
							Create a new material using the &ldquo;Create New&rdquo; tab.
						</p>
					</div>
				) : (
					<div className="space-y-2">
						{filteredMaterials.map((material) => {
							const isInAuction = materialsInAuction.has(material.materialId);
							const isAdding = addingMaterials.has(material.materialId);
							const messageInfo = successMessages.get(material.materialId);

							return (
								<div key={material._id}>
									<MaterialRow
										material={material}
										isInAuction={isInAuction}
										onAdd={() => handleAddMaterial(material.materialId)}
										isAdding={isAdding}
									/>
									{messageInfo && (
										<div
											className="mt-1 px-3 py-1.5 rounded-md text-xs flex items-center gap-2"
											style={{
												backgroundColor: messageInfo.isSuccess
													? "rgba(34, 197, 94, 0.1)"
													: "rgba(239, 68, 68, 0.1)",
												color: messageInfo.isSuccess ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)",
											}}
										>
											{messageInfo.isSuccess ? (
												<CheckCircle2 size={12} />
											) : (
												<AlertCircle size={12} />
											)}
											<span>{messageInfo.message}</span>
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Summary */}
			{filteredMaterials.length > 0 && (
				<div className="pt-3 border-t" style={{ borderColor: "var(--border-default)" }}>
					<p className="text-xs" style={{ color: "var(--text-secondary)" }}>
						{filteredMaterials.length} material{filteredMaterials.length === 1 ? "" : "s"} available
						• {filteredMaterials.filter((m) => !materialsInAuction.has(m.materialId)).length} can be
						added
					</p>
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Modal Content with Tabs
// ============================================================================
function AddMaterialsModalContent({
	onClose,
}: Readonly<{
	onClose: () => void;
}>) {
	const [activeTab, setActiveTab] = useState<TabType>("add-existing");

	return (
		<div
			className="p-6 rounded-xl max-h-[85vh] flex flex-col"
			style={{
				backgroundColor: "var(--bg-secondary)",
				border: "1px solid var(--border-default)",
			}}
		>
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<div>
					<h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
						Add Materials to Auction
					</h2>
					<p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
						{activeTab === "add-existing"
							? "Select approved materials to add to the current live auction."
							: "Create a new material that will be submitted for approval."}
					</p>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="p-1 rounded-md transition-colors hover:opacity-80"
					style={{ color: "var(--text-muted)" }}
				>
					<X size={20} />
				</button>
			</div>

			{/* Tabs */}
			<div
				className="flex gap-1 p-1 rounded-lg mb-4"
				style={{ backgroundColor: "var(--bg-primary)" }}
			>
				<button
					type="button"
					onClick={() => setActiveTab("add-existing")}
					className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
						activeTab === "add-existing" ? "shadow-sm" : ""
					}`}
					style={{
						backgroundColor: activeTab === "add-existing" ? "var(--bg-secondary)" : "transparent",
						color: activeTab === "add-existing" ? "var(--text-primary)" : "var(--text-secondary)",
					}}
				>
					<ListPlus size={16} />
					<span>Add Existing</span>
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("create-new")}
					className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
						activeTab === "create-new" ? "shadow-sm" : ""
					}`}
					style={{
						backgroundColor: activeTab === "create-new" ? "var(--bg-secondary)" : "transparent",
						color: activeTab === "create-new" ? "var(--text-primary)" : "var(--text-secondary)",
					}}
				>
					<Plus size={16} />
					<span>Create New</span>
				</button>
			</div>

			{/* Tab Content */}
			<div className="flex-1 overflow-y-auto min-h-0">
				{activeTab === "add-existing" ? (
					<AddExistingMaterialsContent />
				) : (
					<CreateMaterialForm
						onSuccess={() => setActiveTab("add-existing")}
						onCancel={() => setActiveTab("add-existing")}
					/>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Main Export Component
// ============================================================================
/**
 * Add Materials Button with Modal
 * Renders a button that opens a modal for adding materials to the live auction
 */
export function AddMaterialsToAuction() {
	const { isAuthenticated } = useConvexAuth();
	const [isModalOpen, setIsModalOpen] = useState(false);

	// Get user roles to check permissions
	// Extract the first element from the tuple [data, error] returned by AsyncReturn
	const { data: rawUserRoles } = useQuery({
		...convexQuery(api.admin.getCurrentUserRoles, {}),
		enabled: isAuthenticated,
	});
	const userRoles: string[] = useMemo(
		() => (Array.isArray(rawUserRoles) && rawUserRoles[0] !== null ? rawUserRoles[0] : []),
		[rawUserRoles]
	);

	const isAdmin = useMemo(() => userRoles.includes("admin"), [userRoles]);
	const isSeller = useMemo(() => userRoles.includes("seller"), [userRoles]);
	const canAddMaterials = isAdmin || isSeller;

	// Don't render anything if user can't add materials
	if (!isAuthenticated || !canAddMaterials) {
		return null;
	}

	return (
		<>
			<button
				type="button"
				onClick={() => setIsModalOpen(true)}
				className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-90"
				style={{
					backgroundColor: "rgb(59, 130, 246)",
					color: "white",
				}}
			>
				<Plus size={16} />
				<span>Add Materials</span>
			</button>

			<Modal
				isOpen={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				ariaLabel="Add Materials to Auction"
				size="5xl"
			>
				<AddMaterialsModalContent onClose={() => setIsModalOpen(false)} />
			</Modal>
		</>
	);
}
