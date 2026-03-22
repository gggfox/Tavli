/**
 * Icon Mapper Utility
 * Maps icon name strings to lucide-react icon components
 */
import {
	Award,
	BarChart3,
	Box,
	Circle,
	CornerDownRight,
	Cylinder,
	Grid3x3,
	GripVertical,
	Hexagon,
	Layers,
	Package,
	RectangleHorizontal,
	Sparkles,
	Square,
	Star,
	Zap,
	type LucideIcon,
} from "lucide-react";

/**
 * Mapping of icon names to lucide-react icon components
 */
const iconMap: Record<string, LucideIcon> = {
	Package,
	Box,
	Layers,
	Grid3x3,
	GripVertical,
	BarChart3,
	Cylinder,
	Circle,
	Zap,
	Sparkles,
	Star,
	Award,
	Hexagon,
	Square,
	CornerDownRight,
	RectangleHorizontal,
};

/**
 * Default icon to use when icon name is not found
 */
const DefaultIcon = Box;

/**
 * Get the icon component for a given icon name
 * @param iconName - The name of the icon (e.g., "Package", "Box")
 * @returns The lucide-react icon component, or a default icon if not found
 */
export function getIconComponent(iconName: string | undefined): LucideIcon {
	if (!iconName) {
		return DefaultIcon;
	}

	const Icon = iconMap[iconName];
	return Icon || DefaultIcon;
}
