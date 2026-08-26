/**
 * "Most popular" strip at the top of the diner menu (TAVLI-98).
 *
 * ## The motion, and why it stops
 *
 * A continuously-scrolling strip that never pauses fails WCAG 2.2.2 (moving
 * content over five seconds needs a pause mechanism) and — more immediately —
 * you cannot tap a card that is sliding out from under your thumb. So the
 * marquee pauses on hover and on touch, which makes the card tappable at the
 * moment a diner reaches for it.
 *
 * `prefers-reduced-motion` turns it into a plain horizontal snap-scroll rail:
 * same cards, same order, no movement. Not a degraded version — for a lot of
 * people it is the better one.
 *
 * ## Why CSS and not a timer
 *
 * A `setInterval` advancing a scroll position competes with the diner's own
 * finger, keeps running when the tab is backgrounded, and has to be torn down
 * on unmount. A duplicated track under one CSS animation has none of those
 * problems and costs no JavaScript at all.
 *
 * The track is rendered **twice**. The animation translates by exactly -50%,
 * so as the first copy leaves the viewport the second is precisely where the
 * first began — the loop has no seam and no jump.
 */
import { formatCents } from "@/global/utils/money";
import { OrderingKeys } from "@/global/i18n";
import { getTranslatedField } from "@/global/utils/translations";
import { useTranslation } from "react-i18next";
import type { MenuItemWithImage } from "./ItemDetailSheet";

interface PopularItemsCarouselProps {
	readonly items: readonly MenuItemWithImage[];
	readonly lang?: string;
	readonly onOpenDetail: (item: MenuItemWithImage) => void;
}

export function PopularItemsCarousel({
	items,
	lang,
	onOpenDetail,
}: Readonly<PopularItemsCarouselProps>) {
	const { t } = useTranslation();
	if (items.length === 0) return null;

	return (
		<section aria-labelledby="popular-heading" className="-mx-4">
			<h2 id="popular-heading" className="px-4 pb-2 text-sm font-semibold text-foreground">
				{t(OrderingKeys.MENU_POPULAR_HEADING)}
			</h2>

			{/*
			 * `group` drives the pause: `group-hover` for a mouse and
			 * `group-active` for a finger, both on the container so the whole
			 * strip stops rather than just the card under the pointer — a strip
			 * where one card freezes and the rest keep moving looks broken.
			 */}
			<div className="group relative overflow-hidden">
				<ul
					className="
						flex w-max gap-3 px-4
						motion-safe:animate-marquee
						motion-safe:group-hover:[animation-play-state:paused]
						motion-safe:group-active:[animation-play-state:paused]
						motion-reduce:w-auto motion-reduce:overflow-x-auto motion-reduce:snap-x
						motion-reduce:snap-mandatory
					"
				>
					{/*
					 * Two passes over the same items. The second is `aria-hidden`
					 * and inert: a screen reader must hear each dish once, and a
					 * keyboard user must not tab through a duplicate of a list they
					 * have already crossed.
					 */}
					{items.map((item) => (
						<PopularCard key={item._id} item={item} lang={lang} onOpenDetail={onOpenDetail} />
					))}
					{items.map((item) => (
						<PopularCard
							key={`dup-${item._id}`}
							item={item}
							lang={lang}
							onOpenDetail={onOpenDetail}
							duplicate
						/>
					))}
				</ul>
			</div>
		</section>
	);
}

function PopularCard({
	item,
	lang,
	onOpenDetail,
	duplicate = false,
}: Readonly<{
	item: MenuItemWithImage;
	lang?: string;
	onOpenDetail: (item: MenuItemWithImage) => void;
	duplicate?: boolean;
}>) {
	const name = getTranslatedField(item, lang);
	return (
		<li
			className="w-40 shrink-0 motion-reduce:snap-start"
			{...(duplicate ? { "aria-hidden": true } : {})}
		>
			<button
				type="button"
				// The duplicate track exists only to make the loop seamless. Left
				// focusable it would double the tab stops on the strip.
				tabIndex={duplicate ? -1 : 0}
				onClick={() => onOpenDetail(item)}
				className="w-full overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:bg-(--bg-hover)"
			>
				{item.imageUrl ? (
					<img
						src={item.imageUrl}
						alt=""
						width={160}
						height={112}
						// Explicit dimensions: preflight's `img { height: auto }`
						// leaves an undecoded image with no intrinsic size, which
						// collapses the strip and then snaps it open.
						className="h-28 w-full object-cover"
						loading="lazy"
					/>
				) : null}
				<div className="px-2.5 py-2">
					<p className="truncate text-sm font-medium text-foreground">{name}</p>
					<p className="text-sm font-bold text-foreground">${formatCents(item.basePrice)}</p>
				</div>
			</button>
		</li>
	);
}
