/**
 * Represents information about a method in a route node.
 */
export interface MethodInfo {
	name: string;
	returnType: string;
	inputType: string;
	handlerCode?: string;
	schemaName?: string;
	schemaAlias?: string;
	schemaImportPath?: string;
	paramName?: string;
	bodyParams?: string[];
	bodyVariableName?: string;
}

/**
 * Represents information about an import declaration in a route node.
 */
export interface ImportDeclarationInfo {
	moduleSpecifier: string;
	defaultImport?: string;
	namespaceImport?: string;
	namedImports: Array<{ name: string; alias?: string }>;
	isTypeOnly: boolean;
}

/**
 * Represents a route node in the route tree.
 */
export interface RouteNode {
	segment: string;
	methods: MethodInfo[];
	imports?: ImportDeclarationInfo[];
	children: Record<string, RouteNode>;
}
