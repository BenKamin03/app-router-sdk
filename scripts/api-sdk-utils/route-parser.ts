import * as fs from 'fs';
import * as path from 'path';
import { SyntaxKind, Project, SourceFile, FunctionDeclaration, ArrowFunction, Signature, ParameterDeclaration, CallExpression, AwaitExpression, Node } from 'ts-morph';
import type { MethodInfo, RouteNode, ImportDeclarationInfo } from './types.ts';
import { refineMethodTypes } from './type-utils.ts';

/**
 * Extracts HTTP method handlers (GET, POST, etc.) defined in the route file content using regular expressions.
 * This provides an initial list of methods before deeper analysis with ts-morph.
 * @param content - The content of the route file
 * @returns A map of method names to their initial method info
 */
function extractMethodsWithRegex(content: string): Map<string, MethodInfo> {
	const methodsMap = new Map<string, MethodInfo>();
	const patterns = [
		// Match functions like: export async function GET(...): ReturnType { ... }
		/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*\([^)]*\)\s*:\s*([^ {]+)/g,
		// Match arrow functions like: export const POST = async (...): ReturnType => { ... }
		/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*=\s*async\s*\([^)]*\)\s*:\s*([^=]+?)\s*=>/g,
		// Fallback to match names if type annotation is missing
		/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\b/g,
	];

	patterns.forEach((pattern) => {
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(content)) !== null) {
			const name = m[1];
			if (!methodsMap.has(name)) {
				methodsMap.set(name, { name, returnType: m[2]?.trim() || 'unknown', inputType: 'unknown' });
			} else if (!methodsMap.get(name)!.returnType || methodsMap.get(name)!.returnType === 'unknown') {
				methodsMap.get(name)!.returnType = m[2]?.trim() || 'unknown';
			}
		}
	});

	return methodsMap;
}

/**
 * Extracts import declarations from a source file.
 * @param sourceFile - The source file to extract imports from
 * @returns The import declarations
 */
function extractImportsFromSourceFile(sourceFile: SourceFile): ImportDeclarationInfo[] {
	return sourceFile.getImportDeclarations().map((imp) => ({
		moduleSpecifier: imp.getModuleSpecifierValue(),
		defaultImport: imp.getDefaultImport()?.getText(),
		namespaceImport: imp.getNamespaceImport()?.getText(),
		namedImports: imp.getNamedImports().map((ni) => ({
			name: ni.getName(),
			alias: ni.getAliasNode()?.getText(),
		})),
		isTypeOnly: imp.isTypeOnly(),
	}));
}

/**
 * Removes a specific wrapper from the text.
 * @param text - The text to remove the wrapper from
 * @param prefix - The prefix of the wrapper
 * @returns The text with the wrapper removed
 */
const removeWrapper = (text: string, prefix: string): string => {
	let res = '';
	let idx = 0;
	while (idx < text.length) {
		if (text.startsWith(prefix, idx)) {
			idx += prefix.length;
			let depth = 1;
			const start = idx;
			while (idx < text.length && depth > 0) {
				if (text[idx] === '(') depth++;
				else if (text[idx] === ')') depth--;
				idx++;
			}
			res += text.slice(start, idx - 1);
		} else {
			res += text[idx++];
		}
	}
	return res;
};

/**
 * Removes a specific wrapper from the text.
 * @param text - The text to remove the wrapper from
 * @param prefix - The prefix of the wrapper
 * @returns The text with the wrapper removed
 */
const removeNewWrapper = (text: string, prefix: string): string => {
	let res = '';
	let idx = 0;
	while (idx < text.length) {
		if (text.startsWith(prefix, idx)) {
			idx += prefix.length;
			let parenDepth = 1;
			let bracketDepth = 0;
			let curlyDepth = 0;
			const start = idx;
			let commaPos = -1;
			let inString = false;
			let stringChar = '';
			while (idx < text.length && parenDepth > 0) {
				const ch = text[idx];
				if (inString) {
					if (ch === '\\') {
						idx += 2;
						continue;
					}
					if (ch === stringChar) {
						inString = false;
					}
				} else {
					if (ch === '"' || ch === "'" || ch === '`') {
						inString = true;
						stringChar = ch;
					} else if (ch === '(') {
						parenDepth++;
					} else if (ch === ')') {
						parenDepth--;
					} else if (ch === '[') {
						bracketDepth++;
					} else if (ch === ']') {
						bracketDepth--;
					} else if (ch === '{') {
						curlyDepth++;
					} else if (ch === '}') {
						curlyDepth--;
					} else if (
						ch === ',' &&
						parenDepth === 1 &&
						bracketDepth === 0 &&
						curlyDepth === 0 &&
						commaPos < 0
					) {
						commaPos = idx;
					}
				}
				idx++;
			}
			const endArgIdx = idx - 1;
			const bodyArg = commaPos > 0 ? text.slice(start, commaPos) : text.slice(start, endArgIdx);
			if (commaPos > 0) {
				const initArg = text.slice(commaPos + 1, endArgIdx);
				const statusMatch = /status\s*:\s*([0-9]+)/.exec(initArg);
				const statusCode = statusMatch ? statusMatch[1] : null;
				if (statusCode && statusCode !== '200') {
					res += `( () => { const __body = ${bodyArg}; throw new Error(JSON.stringify(__body)); } )()`;
					continue;
				}
			}
			res += bodyArg;
		} else {
			res += text[idx++];
		}
	}
	return res;
};

/**
 * Strips the comma operator in return statements.
 * @param text - The text to strip the comma operator from
 * @returns The text with the comma operator stripped
 */
const stripReturnComma = (text: string): string => {
	if (!text.trim().startsWith('return')) return text;
	let res = '';
	let idx = 0;
	let depth = 0;
	let inString = false;
	let stringChar = '';
	while (idx < text.length) {
		const ch = text[idx];
		if (inString) {
			res += ch;
			if (ch === '\\') {
				res += text[idx + 1] || '';
				idx += 2;
				continue;
			}
			if (ch === stringChar) inString = false;
			idx++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = true;
			stringChar = ch;
			res += ch;
			idx++;
			continue;
		}
		if (ch === '(' || ch === '{' || ch === '[') {
			depth++;
			res += ch;
			idx++;
			continue;
		}
		if (ch === ')' || ch === '}' || ch === ']') {
			depth--;
			res += ch;
			idx++;
			continue;
		}
		if (ch === ',' && depth === 0) {
			break;
		}
		res += ch;
		idx++;
	}
	const tail = text.slice(idx).match(/^.*?;/);
	if (tail) res += ';';
	return res;
};

/**
 * Extracts and cleans the handler code for each method, removing common wrappers.
 * @param sourceFile - The source file containing the methods
 * @param methods - The methods to extract and process
 */
function extractAndProcessHandlerCode(sourceFile: SourceFile, methods: MethodInfo[]): void {
	methods.forEach((info) => {
		const handlerDecl = sourceFile.getVariableDeclaration(info.name);
		const handlerNode =
			handlerDecl?.getInitializerIfKind(SyntaxKind.ArrowFunction) ?? sourceFile.getFunction(info.name);

		if (handlerNode) {
			const params = handlerNode.getParameters();
			info.paramName = params.length > 0 ? params[0].getName() : 'req';

			let bodyText = '';
			const bodyNode = handlerNode.getBody();

			if (bodyNode) {
				if (bodyNode.isKind(SyntaxKind.Block)) {
					const full = bodyNode.getText();
					bodyText = full.slice(1, -1).trim();
				} else {
					bodyText = `return ${bodyNode.getText()};`;
				}

				['JSON.stringify('].forEach((prefix) => {
					bodyText = removeWrapper(bodyText, prefix);
				});
				[
					'NextResponse.json(',
					'Response.json(',
					'new NextResponse(',
					'new Response(',
					'new NextApiResponse(',
				].forEach((prefix) => {
					bodyText = removeNewWrapper(bodyText, prefix);
				});
				bodyText = stripReturnComma(bodyText);

				info.handlerCode = bodyText.trim();
				const captureLines = info.handlerCode.split('\n');
				for (const line of captureLines) {
					const dm = line.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[A-Za-z_$][\w$]*\.json\(\)/);
					if (dm) {
						info.bodyVariableName = dm[1];
						break;
					}
				}
			} else {
				info.handlerCode = '';
			}

			if (info.inputType === 'unknown' && info.name !== 'GET') {
				const bodyParams: string[] = [];
				const lines = (info.handlerCode ?? '').split('\n');
				const varNameMapping: Record<string, boolean> = {};
				lines.forEach((line) => {
					const directMatch = line.match(
						/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[A-Za-z_$][\w$]*\.json\(\)/,
					);
					if (directMatch) {
						info.bodyVariableName = directMatch[1];
						varNameMapping[directMatch[1]] = true;
					}
					const destructMatch = line.match(/const\s*{([^}]+)}\s*=\s*(?:await\s+)?[A-Za-z_$][\w$]*\.json\(\)/);
					if (destructMatch) {
						destructMatch[1].split(',').forEach((part) => {
							const name = part.split(':')[0].trim();
							if (name) bodyParams.push(name);
						});
					}
				});
				lines.forEach((line) => {
					const destructVarMatch = line.match(/const\s*{([^}]+)}\s*=\s*([A-Za-z_$][\w$]*)/);
					if (destructVarMatch && varNameMapping[destructVarMatch[2]]) {
						destructVarMatch[1].split(',').forEach((part) => {
							const name = part.split(':')[0].trim();
							if (name) bodyParams.push(name);
						});
					}
				});
				info.bodyParams = Array.from(new Set(bodyParams));
			}

			const topLevel = sourceFile.getStatements();
			const usedDecls: string[] = [];
			const methodNames = methods.map((m) => m.name);
			topLevel.forEach((stmt) => {
				if (stmt.getKind() === SyntaxKind.ImportDeclaration || stmt.getKind() === SyntaxKind.ExportDeclaration)
					return;
				if (stmt.getKind() === SyntaxKind.VariableStatement) {
					const varStmt = stmt.asKind(SyntaxKind.VariableStatement)!;
					const declNames = varStmt.getDeclarations().map((d) => d.getName());
					if (declNames.some((n) => methodNames.includes(n))) return;
					if (declNames.some((n) => (info.handlerCode ?? '').includes(n))) usedDecls.push(varStmt.getText());
					return;
				}
				if (stmt.getKind() === SyntaxKind.FunctionDeclaration) {
					const fnDecl = stmt.asKind(SyntaxKind.FunctionDeclaration)!;
					const name = fnDecl.getName();
					if (!name || methodNames.includes(name)) return;
					if ((info.handlerCode ?? '').includes(name)) usedDecls.push(fnDecl.getText());
					return;
				}
			});
			if (usedDecls.length) {
				const schemaDecls = topLevel
					.filter(stmt => stmt.getKind() === SyntaxKind.VariableStatement)
					.filter(stmt => {
						const text = stmt.asKind(SyntaxKind.VariableStatement)!.getText();
						return /^\s*const\s+\w+\s*=\s*z\.object/.test(text);
					})
					.map(stmt => stmt.asKind(SyntaxKind.VariableStatement)!.getText());

				const allDecls = Array.from(new Set([...schemaDecls, ...usedDecls]));
				info.handlerCode = allDecls.join('\n') + '\n' + (info.handlerCode ?? '');
			}
		}
	});
}

/**
 * Processes a single route.ts file, extracting methods, imports, types, and handler code.
 * @param project - The project instance
 * @param routeFile - The route file to process
 * @param node - The node to process
 */
async function processRouteFile(project: Project, routeFile: string, node: RouteNode): Promise<void> {
	try {
		await fs.promises.access(routeFile);
	} catch {
		return;
	}
	const content = await fs.promises.readFile(routeFile, 'utf8');
	const methodsMap = extractMethodsWithRegex(content);
	node.methods = Array.from(methodsMap.values());

	if (node.methods.length > 0) {
		const sourceFile = project.getSourceFileOrThrow(routeFile);
		node.imports = extractImportsFromSourceFile(sourceFile);
		refineMethodTypes(sourceFile, node.methods);
		extractAndProcessHandlerCode(sourceFile, node.methods);
	}
}

/**
 * Recursively processes child directories to build the route tree structure.
 * @param project - The project instance
 * @param dir - The directory to process
 * @param node - The node to process
 */
async function processChildDirectories(project: Project, dir: string, node: RouteNode): Promise<void> {
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });
	const tasks: Promise<void>[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
		tasks.push(
			(async () => {
				const childDir = path.join(dir, entry.name);
				const childSegment = entry.name;

				if (childSegment.toLowerCase() === 'api') {
					const apiNode = await parseRoutes(project, childDir);
					node.methods.push(...apiNode.methods);
					Object.assign(node.children, apiNode.children);
					return;
				}

				if (childSegment.startsWith('(') && childSegment.endsWith(')')) {
					const groupNode = await parseRoutes(project, childDir);
					node.methods.push(...groupNode.methods);
					Object.assign(node.children, groupNode.children);
					return;
				}

				const childNode = await parseRoutes(project, childDir);
				childNode.segment = childSegment;

				let key: string;
				if (childSegment.startsWith('[...') && childSegment.endsWith(']')) {
					key = childSegment.slice(4, -1);
				} else if (childSegment.startsWith('[') && childSegment.endsWith(']')) {
					key = childSegment.slice(1, -1);
				} else {
					key = childSegment;
				}

				node.children[key] = childNode;
			})()
		);
	}
	await Promise.all(tasks);
}

/**
 * Parses the routes from the given directory, recursively building a tree.
 * @param project - The project instance
 * @param dir - The directory to parse the routes from
 * @returns The parsed routes root node for the given directory
 */
export async function parseRoutes(project: Project, dir: string): Promise<RouteNode> {
	const node: RouteNode = {
		segment: path.basename(dir),
		methods: [],
		children: {},
	};

	const routeFile = path.join(dir, 'route.ts');
	await processRouteFile(project, routeFile, node);
	await processChildDirectories(project, dir, node);

	return node;
}
