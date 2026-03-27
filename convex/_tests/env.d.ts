interface ImportMetaEnv {}

interface ImportMeta {
	readonly env: ImportMetaEnv;
	glob(pattern: string): Record<string, () => Promise<unknown>>;
}
