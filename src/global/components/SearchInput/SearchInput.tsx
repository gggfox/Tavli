import { Search } from "lucide-react";

export type SearchInputProps = Readonly<{
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
}>;

export function SearchInput({ placeholder, value, onChange }: SearchInputProps) {
	return (
		<div className="relative flex-1 max-w-md">
			<Search
				size={16}
				className="absolute left-3 top-1/2 -translate-y-1/2 text-faint-foreground"
				
			/>
			<input
				type="text"
				placeholder={placeholder}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="w-full pl-9 pr-4 py-2 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-(--btn-primary-bg) focus:border-transparent bg-muted text-foreground border border-border"
				
			/>
		</div>
	);
}
