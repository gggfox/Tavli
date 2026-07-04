import { Tooltip } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import { ImagePlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface MenuItemImagePreviewProps {
	imageUrl?: string | null;
	itemName: string;
}

export function MenuItemImagePreview({ imageUrl, itemName }: Readonly<MenuItemImagePreviewProps>) {
	const { t } = useTranslation();
	const [imageBroken, setImageBroken] = useState(false);
	const hasPreviewImage = Boolean(imageUrl) && !imageBroken;

	const tooltipContent = hasPreviewImage ? (
		<img
			src={imageUrl ?? undefined}
			alt={itemName}
			className="block max-w-[240px] max-h-[240px] rounded object-cover"
			onError={() => setImageBroken(true)}
		/>
	) : (
		<span className="px-2.5 py-1.5 text-faint-foreground">{t(MenusKeys.ITEM_NO_IMAGE)}</span>
	);

	return (
		<Tooltip
			content={tooltipContent}
			placement="right"
			longPressDelay={500}
			contentPadding={hasPreviewImage ? "none" : "default"}
		>
			<button
				type="button"
				className="shrink-0 rounded p-0 border-0 bg-transparent cursor-default touch-none"
				style={{ WebkitTouchCallout: "none" }}
				aria-label={
					hasPreviewImage
						? t(MenusKeys.ITEM_IMAGE_PREVIEW_ARIA, { name: itemName })
						: t(MenusKeys.ITEM_NO_IMAGE)
				}
			>
				{imageUrl && !imageBroken ? (
					<img
						src={imageUrl}
						alt=""
						aria-hidden
						className="w-10 h-10 rounded object-cover flex-shrink-0 pointer-events-none"
					/>
				) : (
					<div className="w-10 h-10 rounded flex-shrink-0 flex items-center justify-center bg-muted border border-border pointer-events-none">
						<ImagePlus size={14} className="text-faint-foreground" />
					</div>
				)}
			</button>
		</Tooltip>
	);
}
