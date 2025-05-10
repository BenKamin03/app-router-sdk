import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { fileURLToPath } from 'url';
import { Project } from 'ts-morph';
import * as prettier from 'prettier';
import { colorString } from '../utils/general.ts';
import { parseRoutes } from './api-sdk-utils/route-parser.ts';
import { buildObjectCode } from './api-sdk-utils/client-code-builder.ts';
import { buildServerObjectCode } from './api-sdk-utils/server-code-builder.ts';
import type { RouteNode } from './api-sdk-utils/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appDir = path.resolve(__dirname, '../app');

const watchMode = process.argv.includes('--watch');
const debugMode = process.argv.includes('--debug');

if (debugMode) console.log(colorString(`[INIT]`, 'cyan') + ' Generating initial API SDK...');
if (debugMode)
	console.log(colorString(`[WATCHING]`, 'blue') + ` Watching for route.ts changes in the app directory...`);

let project: Project = new Project({
	tsConfigFilePath: path.resolve(__dirname, '../tsconfig.json'),
	skipAddingFilesFromTsConfig: true,
});

const projectRoot = path.resolve(__dirname, '../.prettierrc');
let prettierConfig = await prettier.resolveConfig(projectRoot);

let currentTree: RouteNode;

/**
 * Collects all import declarations from a route node and its children.
 * @param node - The route node to collect imports from.
 * @returns An array of import declarations.
 */
const collectRouteImports = (
	node: import('./api-sdk-utils/types').RouteNode,
): import('./api-sdk-utils/types').ImportDeclarationInfo[] => {
	let imports = node.imports ?? [];
	for (const child of Object.values(node.children)) {
		imports = imports.concat(collectRouteImports(child));
	}
	return imports;
};

/**
 * Combines import declarations from an array of import objects.
 * @param imports - An array of import objects.
 * @returns An array of combined import objects.
 */
const combineImports = (
	imports: import('./api-sdk-utils/types').ImportDeclarationInfo[],
): import('./api-sdk-utils/types').ImportDeclarationInfo[] => {
	const map = new Map<string, import('./api-sdk-utils/types').ImportDeclarationInfo>();
	imports.forEach((imp) => {
		const key = imp.moduleSpecifier;
		const existing = map.get(key);
		if (!existing) {
			map.set(key, { ...imp, namedImports: [...imp.namedImports] });
		} else {
			if (imp.defaultImport && !existing.defaultImport) existing.defaultImport = imp.defaultImport;
			else if (imp.defaultImport && existing.defaultImport !== imp.defaultImport) {
				existing.namedImports.push({ name: imp.defaultImport, alias: imp.defaultImport + '_' });
			}
			if (imp.namespaceImport && !existing.namespaceImport) existing.namespaceImport = imp.namespaceImport;
			imp.namedImports.forEach((ni) => {
				if (!existing.namedImports.some((e) => e.name === ni.name && e.alias === ni.alias)) {
					existing.namedImports.push(ni);
				}
			});
			if (!imp.isTypeOnly) existing.isTypeOnly = false;
		}
	});
	return Array.from(map.values());
};

/**
 * Formats an import declaration into a string.
 * @param imp - The import declaration object.
 * @returns A formatted import string.
 */
const formatImport = (imp: import('./api-sdk-utils/types').ImportDeclarationInfo): string => {
	const { moduleSpecifier, defaultImport, namespaceImport, namedImports, isTypeOnly } = imp;
	const typeOnly = isTypeOnly ? 'type ' : '';
	if (namespaceImport) {
		return `import ${typeOnly}* as ${namespaceImport} from '${moduleSpecifier}';`;
	}
	const parts: string[] = [];
	if (defaultImport) parts.push(defaultImport);
	if (namedImports.length > 0) {
		const named = namedImports.map((n) => (n.alias ? `${n.name} as ${n.alias}` : n.name)).join(', ');
		parts.push(`{ ${named} }`);
	}
	return `import ${typeOnly}${parts.join(', ')} from '${moduleSpecifier}';`;
};

/**
 * Counts the occurrences of each imported identifier.
 * @param imports - An array of import objects.
 * @returns A map of imported identifiers to their counts.
 */
const countImportIdentifiers = (
	imports: import('./api-sdk-utils/types').ImportDeclarationInfo[],
): Map<string, number> => {
	const nameCount = new Map<string, number>();
	for (const imp of imports) {
		if (imp.defaultImport) nameCount.set(imp.defaultImport, (nameCount.get(imp.defaultImport) || 0) + 1);
		if (imp.namespaceImport) nameCount.set(imp.namespaceImport, (nameCount.get(imp.namespaceImport) || 0) + 1);
		for (const ni of imp.namedImports) {
			const importName = ni.alias || ni.name;
			nameCount.set(importName, (nameCount.get(importName) || 0) + 1);
		}
	}
	return nameCount;
};

/**
 * Applies aliases to conflicting import identifiers.
 * @param imports - An array of import objects.
 * @param nameCount - A map of imported identifiers to their counts.
 */
const applyImportAliases = (
	imports: import('./api-sdk-utils/types').ImportDeclarationInfo[],
	nameCount: Map<string, number>,
): void => {
	const used = new Map<string, number>();
	for (const imp of imports) {
		if (imp.defaultImport) {
			const count = nameCount.get(imp.defaultImport) || 0;
			if (count > 1) {
				const occ = used.get(imp.defaultImport) || 0;
				if (occ > 0) imp.defaultImport = `${imp.defaultImport}_${occ}`;
				used.set(imp.defaultImport, occ + 1);
			}
		}
		if (imp.namespaceImport) {
			const count = nameCount.get(imp.namespaceImport) || 0;
			if (count > 1) {
				const occ = used.get(imp.namespaceImport) || 0;
				if (occ > 0) imp.namespaceImport = `${imp.namespaceImport}_${occ}`;
				used.set(imp.namespaceImport, occ + 1);
			}
		}
		for (const ni of imp.namedImports) {
			const importName = ni.alias || ni.name;
			const cnt = nameCount.get(importName) || 0;
			if (cnt > 1) {
				const occ = used.get(importName) || 0;
				if (occ > 0) ni.alias = `${ni.name}_${occ}`;
				used.set(importName, occ + 1);
			}
		}
	}
};

/**
 * Applies aliases to conflicting import identifiers.
 * @param imports - An array of import objects.
 */
const aliasConflictingImports = (imports: import('./api-sdk-utils/types').ImportDeclarationInfo[]): void => {
	const nameCount = countImportIdentifiers(imports);
	applyImportAliases(imports, nameCount);
};

/**
 * Filters out unused import declarations.
 * @param imports - An array of import objects.
 * @param codeStrings - An array of code strings.
 * @returns An array of import objects.
 */
const filterUnusedImports = (
	imports: import('./api-sdk-utils/types').ImportDeclarationInfo[],
	codeStrings: string[],
): import('./api-sdk-utils/types').ImportDeclarationInfo[] => {
	return imports.filter((imp) => {
		const importedNames: string[] = [];
		if (imp.defaultImport) importedNames.push(imp.defaultImport);
		if (imp.namespaceImport) importedNames.push(imp.namespaceImport + '.');
		imp.namedImports.forEach((ni) => importedNames.push(ni.alias ?? ni.name));

		return importedNames.some((name) => codeStrings.some((code) => code.includes(name)));
	});
};

/**
 * Formats a code string using Prettier.
 * @param code - The code string to format.
 * @param filePath - The path to the file to format.
 * @returns A formatted code string.
 */
const formatCode = async (code: string, filePath: string, pconfig: prettier.Options | null = prettierConfig): Promise<string> => {
	try {
		if (!pconfig) {
			console.warn(
				colorString(`[PRETTIER]`, 'yellow') +
					` Could not find Prettier config in project root. Using defaults.`,
			);
			return await prettier.format(code, { filepath: filePath });
		}

		return await prettier.format(code, { ...pconfig, filepath: filePath });
	} catch (error) {
		console.warn(colorString(`[PRETTIER]`, 'yellow') + ` Could not format ${path.basename(filePath)}: ${error}`);
		return code;
	}
};

/**
 * Writes a generated SDK file to disk.
 * @param filePath - The path to the file to write.
 * @param contents - The contents of the file to write.
 */
const writeSdkFile = (filePath: string, contents: string): void => {
	const outDir = path.dirname(filePath);
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(filePath, contents, 'utf8');
};

/**
 * Generates a client SDK file.
 * @param tree - The route tree.
 * @param combinedImports - The combined import declarations.
 * @returns The path to the generated client SDK file.
 */
const generateClientSdk = async (
	tree: import('./api-sdk-utils/types').RouteNode,
	combinedImports: import('./api-sdk-utils/types').ImportDeclarationInfo[],
): Promise<string> => {
	const clientBody = buildObjectCode(tree);
	const clientImports = filterUnusedImports([...combinedImports], [clientBody]);
	aliasConflictingImports(clientImports);
	const clientImportLines = clientImports.map(formatImport);

	if (clientBody.includes('tryCatchFunction')) {
		clientImportLines.push('import { tryCatchFunction } from "../utils/tryCatch.ts";');
	}

	const sdkContents = [
		"'use client';",
		'',
		'/* Auto-generated API SDK - do not edit */',
		...clientImportLines,
		'',
		"import { useQuery, useMutation, useInfiniteQuery } from 'react-query';",
		"import type { UseQueryResult, UseMutationResult, UseInfiniteQueryResult } from 'react-query';",
		'',
		'export const API = ' + clientBody + ';',
		'',
	].join('\n');

	const outFile = path.resolve(__dirname, '../api/client-sdk.ts');
	const formattedSdk = await formatCode(sdkContents, outFile);
	writeSdkFile(outFile, formattedSdk);
	return outFile;
};

/**
 * Generates a server SDK file.
 * @param tree - The route tree.
 * @param combinedImports - The combined import declarations.
 * @returns The path to the generated server SDK file.
 */
const generateServerSdk = async (
	tree: import('./api-sdk-utils/types').RouteNode,
	combinedImports: import('./api-sdk-utils/types').ImportDeclarationInfo[],
): Promise<string> => {
	const serverBody = buildServerObjectCode(tree);
	const serverImports = filterUnusedImports([...combinedImports], [serverBody]);
	aliasConflictingImports(serverImports);
	const serverImportLines = serverImports.map(formatImport);
	serverImportLines.push('import { tryCatchFunction } from "../utils/tryCatch.ts";');
	serverImportLines.push('import { headers as nextHeaders } from "next/headers";');
	serverImportLines.push('import { cookies as nextCookies } from "next/headers";');
	serverImportLines.push('import { redirect } from "next/navigation";');

	const serverSdkContents = [
		'/* Auto-generated API SERVER SDK - do not edit */',
		'',
		...serverImportLines,
		'',
		'export const API = ' + serverBody + ';',
		'',
	].join('\n');

	const serverOutFile = path.resolve(__dirname, '../api/server-sdk.ts');
	const formattedServerSdk = await formatCode(serverSdkContents, serverOutFile);
	writeSdkFile(serverOutFile, formattedServerSdk);
	return serverOutFile;
};

/**
 * Writes both client and server SDKs from an in-memory route tree.
 */
async function writeSdks(tree: RouteNode) {
	const rawImports = collectRouteImports(tree);
	let combinedImports = combineImports(rawImports);
	aliasConflictingImports(combinedImports);

	const time = performance.now();

	await Promise.all([
		(async () => {
			if (debugMode) console.log(colorString(`[GEN]`, 'magenta') + ' Generating client SDK...');
			const clientSdkPath = await generateClientSdk(tree, combinedImports);
			if (debugMode)
				console.log(colorString(`[GEN]`, 'magenta') + ` Generated client API SDK at ${clientSdkPath}`);
		})(),
		(async () => {
			if (debugMode) console.log(colorString(`[GEN]`, 'magenta') + ' Generating server SDK...');
			const serverSdkPath = await generateServerSdk(tree, combinedImports);
			if (debugMode)
				console.log(colorString(`[GEN]`, 'magenta') + ` Generated server API SDK at ${serverSdkPath}`);
		})(),
	]);

	if (debugMode) console.log(colorString(`[DONE]`, 'green') + ` SDK generation complete in ${Math.round(performance.now() - time)}ms`);


}

/**
 * Handles individual route.ts file events by updating only the affected subtree.
 */
async function handleFileEvent(event: string, filePath: string) {
	const dir = path.dirname(filePath);

	if (event === 'add' || event === 'change') {
		project.addSourceFilesAtPaths(filePath);
	} else if (event === 'unlink') {
		const sf = project.getSourceFile(filePath);
		if (sf) project.removeSourceFile(sf);
	}

	const relPath = path.relative(appDir, dir);
	const segments = relPath.split(path.sep).filter((seg) => seg && !(seg.startsWith('(') && seg.endsWith(')')));

	if (segments.length === 0) {
		currentTree = await parseRoutes(project, appDir);
	} else {
		let parentNode = currentTree!;
		for (let i = 0; i < segments.length - 1; i++) {
			const seg = segments[i];
			const key =
				seg.startsWith('[...') && seg.endsWith(']')
					? seg.slice(4, -1)
					: seg.startsWith('[') && seg.endsWith(']')
						? seg.slice(1, -1)
						: seg;
			parentNode = parentNode.children[key];
			if (!parentNode) {
				console.warn(colorString(`[UPDATE]`, 'yellow') + ` Could not find node for ${seg}`);
				return;
			}
		}
		const lastSeg = segments[segments.length - 1];
		const key =
			lastSeg.startsWith('[...') && lastSeg.endsWith(']')
				? lastSeg.slice(4, -1)
				: lastSeg.startsWith('[') && lastSeg.endsWith(']')
					? lastSeg.slice(1, -1)
					: lastSeg;

		if (event === 'unlink') {
			delete parentNode.children[key];
		} else {
			const newNode = await parseRoutes(project, dir);
			parentNode.children[key] = newNode;
		}
	}

	await writeSdks(currentTree!);
}

/**
 * Generates the API SDK files.
 */
const generateSdk = async (): Promise<void> => {
	const time = performance.now();

	if (debugMode) console.log(colorString(`[PARSE]`, 'blue') + ' Parsing routes and processing imports...');
	// ensure ts-morph knows about all route.ts files when not in watch mode
	project.addSourceFilesAtPaths(path.join(appDir, '**', 'route.ts'));
	const tree = await parseRoutes(project, appDir);
	const rawImports = collectRouteImports(tree);
	let combinedImports = combineImports(rawImports);
	aliasConflictingImports(combinedImports);

	const treeTime = performance.now();
	if (debugMode) console.log(colorString(`[PARSE]`, 'blue') + ` Parsed routes in ${Math.round(treeTime - time)}ms`);

	await writeSdks(tree);
};

if (watchMode) {
	project.addSourceFilesAtPaths(path.join(appDir, '**', 'route.ts'));
	currentTree = await parseRoutes(project, appDir);
	await writeSdks(currentTree);
	if (debugMode)
		console.log(
			colorString(`[DONE]`, 'green') + ' Initial SDK generation complete. Watching for route.ts changes...',
		);

	const watcher = chokidar.watch(path.join(appDir, '**', 'route.ts'), { persistent: true, ignoreInitial: true });

	watcher.on('add', (f) => debugMode && console.log(colorString(`[FOUND]`, 'green') + ` Route file detected: ${f}`));
	watcher.on(
		'change',
		(f) => debugMode && console.log(colorString(`[CHANGED]`, 'yellow') + ` Route file changed: ${f}`),
	);
	watcher.on(
		'unlink',
		(f) => debugMode && console.log(colorString(`[REMOVED]`, 'red') + ` Route file removed: ${f}`),
	);

	watcher.on('all', async (event, f) => {
		if (debugMode) console.log(colorString(`[REGEN]`, 'magenta') + ` Regenerating SDK due to ${event} on ${f}`);
		const time = performance.now();
		await handleFileEvent(event, f);
		if (debugMode) console.log(colorString(`[REGEN]`, 'magenta') + ` Regenerated SDK in ${Math.round(performance.now() - time)}ms`);
	});
} else {
	generateSdk()
		.then(() => {
			if (debugMode)
				console.log(
					colorString(`[DONE]`, 'green') + ' SDK generation complete. Run with --watch to enable hot reloading.',
				);
		})
		.catch((error) => {
			console.error(colorString(`[ERROR]`, 'red') + ' Failed to generate SDK:', error);
			process.exit(1);
		});
}
