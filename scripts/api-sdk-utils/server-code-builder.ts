import type { RouteNode, MethodInfo } from './types.ts';

function createFunctionString(params: string, body: string): string {
	return `(${params}) => tryCatchFunction(async () => {
${body}
})`;
}

/**
 * Builds the code string for a single HTTP method handler within the SDK object.
 * @param methodInfo - Information about the method.
 * @returns The code string for the method handler.
 */
function buildMethodHandlerCode(methodInfo: MethodInfo): string {
	const methodName = methodInfo.name;
	const isGet = methodName === 'GET';
	const usesBody = !isGet && (
		methodInfo.inputType !== 'unknown' ||
		Boolean(methodInfo.bodyVariableName) ||
		((methodInfo.bodyParams?.length ?? 0) > 0)
	);
	const inputType = methodInfo.inputType;

	if (methodInfo.handlerCode?.includes('NextResponse.redirect')) {
		const match = /NextResponse\.redirect\(\s*(['"])(.*?)\1/.exec(methodInfo.handlerCode);
		const redirectUrl = match ? match[2] : '';
		const optionsType = `{ searchParams?: Record<string, string> }`;
		const paramsString = `{ searchParams }: ${optionsType} = {}`;
		const bodyContent = `const url = 'http://localhost' + (searchParams ? '?' + new URLSearchParams(searchParams) : '');\nredirect('${redirectUrl}');`;
		return `  ${methodName}: ${createFunctionString(paramsString, bodyContent)},`;
	}

	const handlerCode = methodInfo.handlerCode || '';
	const handlerRawLines = handlerCode.split('\n');
	const infiniteIndex = handlerRawLines.findIndex((line) => line.includes('use infinite'));
	if (infiniteIndex >= 0) {
		const rawLines = handlerRawLines.filter((line) =>
			!line.includes('use infinite') &&
			!line.includes('req.nextUrl') &&
			!line.includes('await req.json()') &&
			!/^\s*const \{\s*searchParams.*\}/.test(line) &&
			!/^\s*const page =/.test(line)
		);

		const infiniteParams = usesBody
			? `{ body, searchParams }: { body: ${inputType}; searchParams?: Record<string, string> }, pageParam: number = 1`
			: `{ searchParams }: { searchParams?: Record<string, string> }, pageParam: number = 1`;

		const infiniteBodyLines: string[] = [];
		infiniteBodyLines.push('  const page = pageParam;');
		rawLines.forEach((l) => infiniteBodyLines.push('  ' + l));
		const infiniteBody = infiniteBodyLines.join('\n');
		return `  ${methodName}: ${createFunctionString(infiniteParams, infiniteBody)},`;
	}

	const mutationIndex = handlerRawLines.findIndex((line) => line.includes('use mutation'));
	if (mutationIndex >= 0) handlerRawLines.splice(mutationIndex, 1);
	let codeLines = handlerRawLines;
	if (methodName !== 'GET') {
		codeLines = codeLines.filter((line) => !line.includes('.json('));
	}

	const paramName = methodInfo.paramName || 'req';
	const usesSearchParams = codeLines.some(
		(line) => line.includes('searchParams') || line.includes(`${paramName}.nextUrl`)
	);
	const hasHeaderUsage = codeLines.some((line) => line.includes(`${paramName}.headers`));
	const hasCookieUsage = codeLines.some((line) => line.includes(`${paramName}.cookies`));

	const optionProps: string[] = [];
	if (usesBody) optionProps.push(`body: ${inputType}`);
	if (usesSearchParams) optionProps.push('searchParams?: Record<string, string>');
	const optionsType = `{ ${optionProps.join('; ')} }`;
	const propNames = optionProps.map(p => p.split(':')[0].replace('?','').trim());
	if (usesBody) {
		const aliasVar = methodInfo.bodyVariableName;
		if (aliasVar && aliasVar !== 'body') {
			propNames[0] = `body: ${aliasVar}`;
		} else {
			propNames[0] = 'body';
		}
	}
	const destructParams = propNames.join(', ');
	const paramsString = optionProps.length > 0 ? `{ ${destructParams} }: ${optionsType}` : '';

	const bodyLines: string[] = [];
	if (usesSearchParams) {
		bodyLines.push(
			`const ${paramName}: any = { url: 'http://localhost' + (searchParams ? '?' + new URLSearchParams(searchParams) : ''), nextUrl: { searchParams: new URLSearchParams(searchParams) } }` +
			`;`
		);
	}
	if (hasHeaderUsage) bodyLines.push('const headersVal = await nextHeaders();');
	if (hasCookieUsage) bodyLines.push('const cookiesVal = await nextCookies();');

	codeLines.forEach((line) => {
		let replaced = line;
		if (hasHeaderUsage) replaced = replaced.replace(new RegExp(`${paramName}\\.headers`, 'g'), 'headersVal');
		if (hasCookieUsage) replaced = replaced.replace(new RegExp(`${paramName}\\.cookies`, 'g'), 'cookiesVal');
		bodyLines.push(replaced);
	});
	const indentedBody = bodyLines.map((l) => '  ' + l).join('\n');

	return `  ${methodName}: ${createFunctionString(paramsString, indentedBody)},`;
}

/**
 * Builds the code string for a child route within the SDK object.
 * @param key - The key of the child route.
 * @param child - The child route node.
 * @param segments - The path segments.
 * @param depth - The depth of the child route.
 */
function buildChildRouteCode(key: string, child: RouteNode, segments: string[], depth: number): string {
	const lines: string[] = [];
	if (child.segment.startsWith('[...') && child.segment.endsWith(']')) {
		const param = child.segment.slice(4, -1);
		const type = 'string[]';
		const rawChildCode = buildServerObjectCode(child, [...segments, child.segment], depth + 1);
		const replacedChildCode = rawChildCode.replace(
			new RegExp(`(?:\\(await params\\)|params)\\.${param}`, 'g'),
			param,
		);
		const innerLines = replacedChildCode
			.split('\n')
			.slice(1, -1)
			.filter((line) => !line.includes(`const ${param} = ${param}`));
		lines.push(`${key.toUpperCase()}: (${param}: ${type}) => ({`);
		innerLines.forEach((line) => lines.push(line));
		lines.push(`}),`);
	} else if (child.segment.startsWith('[') && child.segment.endsWith(']')) {
		const param = child.segment.slice(1, -1);
		const type = 'string';
		const rawChildCode = buildServerObjectCode(child, [...segments, child.segment], depth + 1);
		const replacedChildCode = rawChildCode.replace(
			new RegExp(`(?:\\(await params\\)|params)\\.${param}`, 'g'),
			param,
		);
		const innerLines = replacedChildCode
			.split('\n')
			.slice(1, -1)
			.filter((line) => !line.includes(`const ${param} = ${param}`));
		lines.push(`${key.toUpperCase()}: (${param}: ${type}) => ({`);
		innerLines.forEach((line) => lines.push(line));
		lines.push(`}),`);
	} else {
		const childCode = buildServerObjectCode(child, [...segments, child.segment], depth + 1);
		lines.push(`  ${key.toUpperCase()}: ${childCode},`);
	}
	return lines.join('\n');
}

/**
 * Builds the code string for the entire SDK object.
 * @param node - The root route node.
 * @param segments - The path segments.
 * @param depth - The depth of the root node.
 * @returns The code string for the SDK object.
 */
export function buildServerObjectCode(node: RouteNode, segments: string[] = [], depth: number = 1): string {
	const lines: string[] = ['{'];

	node.methods.forEach((methodInfo: MethodInfo) => {
		lines.push(buildMethodHandlerCode(methodInfo));
	});

	Object.entries(node.children).forEach(([key, child]) => {
		lines.push(buildChildRouteCode(key, child, segments, depth));
	});

	lines.push('}');
	return lines.join('\n');
}
