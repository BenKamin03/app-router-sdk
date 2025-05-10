import type { RouteNode, MethodInfo } from './types.ts';

/**
 * Builds the template literal string for the API path based on segments.
 * @param segments - The path segments.
 * @returns The path template literal string (e.g., `/${segment}/${param}`).
 */
function buildPathLiteral(segments: string[]): string {
	const pathSegmentsLiteral = segments
		.map((seg) => {
			if (seg.startsWith('(') && seg.endsWith(')')) return '';

			if (seg.startsWith('[...') && seg.endsWith(']')) {
				const param = seg.slice(4, -1);
				return '${' + param + '.join("/")}';
			}
			if (seg.startsWith('[') && seg.endsWith(']')) {
				const param = seg.slice(1, -1);
				return '${' + param + '}';
			}
			return seg;
		})
		.filter(Boolean)
		.join('/');
	return '`/' + pathSegmentsLiteral + '`';
}

/**
 * Builds the code string for a single HTTP method handler within the SDK object.
 * @param methodInfo - Information about the method.
 * @param pathLit - The path template literal string.
 * @returns The code string for the method handler.
 */
function buildMethodCode(methodInfo: MethodInfo, pathLit: string): string {
	const methodName = methodInfo.name;
	const dataType = methodInfo.returnType;
	const isGet = methodName === 'GET';
	const inputType = methodInfo.inputType;

	const usesBody = !isGet && (
		inputType !== 'unknown' ||
		Boolean(methodInfo.bodyVariableName) ||
		((methodInfo.bodyParams?.length ?? 0) > 0)
	);

	const optionProps: string[] = [];

	if (usesBody) optionProps.push(`body: ${inputType}`);

	optionProps.push(`searchParams?: Record<string, string>`);

	const optionsType = `{ ${optionProps.join('; ')} }`;


	const propNames = optionProps.map(p => p.split(':')[0].replace('?','').trim());
	const destructParams = propNames.join(', ');
	const paramsSignature = usesBody
		? `({ ${destructParams} }: ${optionsType})`
		: `({ ${destructParams} }: ${optionsType} = {})`;

	if (methodInfo.handlerCode && methodInfo.handlerCode.includes('NextResponse.redirect')) {
		const execResult = /NextResponse\.redirect\(\s*(['"])(.*?)\1\)/.exec(methodInfo.handlerCode);
		const redirectUrl = execResult && execResult[2] ? execResult[2] : '';
		return (
			`${methodName}: ${paramsSignature}: void => {` +
			`\n  const url = '${redirectUrl}' + (searchParams ? '?' + new URLSearchParams(searchParams) : '');` +
			`\n  window.location.assign(url);` +
			`\n},`
		);
	}
	if (dataType.startsWith('ReadableStream')) {
		if (isGet) {
			return (
				`${methodName}: ${paramsSignature} => ` +
				`tryCatchFunction(async () => {` +
				`\n      const res = await fetch(${pathLit} + (searchParams ? '?' + new URLSearchParams(searchParams) : ''));` +
				`\n      const reader = res.body!.getReader();` +
				`\n      const decoder = new TextDecoder();` +
				`\n      return { reader, decoder };` +
				`\n  }),`
			);
		}

		if (!usesBody) {
			return (
				`${methodName}: ${paramsSignature} => ` +
				`tryCatchFunction(async () => {` +
				`\n      const res = await fetch(${pathLit} + (searchParams ? '?' + new URLSearchParams(searchParams) : ''), { method: '${methodName}' });` +
				`\n      const reader = res.body!.getReader();` +
				`\n      const decoder = new TextDecoder();` +
				`\n      return { reader, decoder };` +
				`\n  }),`
			);
		}
		return (
			`${methodName}: ${paramsSignature} => ` +
			`tryCatchFunction(async () => {` +
			`\n      const res = await fetch(${pathLit} + (searchParams ? '?' + new URLSearchParams(searchParams) : ''), { method: '${methodName}', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });` +
			`\n      const reader = res.body!.getReader();` +
			`\n      const decoder = new TextDecoder();` +
			`\n      return { reader, decoder };` +
			`\n  }),`
		);
	}

	if (isGet) {
		return (
			`${methodName}: ${paramsSignature}: UseQueryResult<${dataType}, unknown> => ` +
			`useQuery<${dataType}, unknown>(['${methodName}', ${pathLit}, searchParams], () => fetch(${pathLit} + (searchParams ? '?' + new URLSearchParams(searchParams) : '')).then(res => res.json())),`
		);
	}
	if (!usesBody) {
		return (
			`${methodName}: ${paramsSignature}: UseMutationResult<${dataType}, unknown, void> => ` +
			`useMutation<${dataType}, unknown, void>(() => fetch(${pathLit} + (searchParams ? '?' + new URLSearchParams(searchParams) : ''), { method: '${methodName}' }).then(res => res.json())),`
		);
	}
	return (
		`${methodName}: ${paramsSignature}: UseMutationResult<${dataType}, unknown, ${inputType}> => ` +
		`useMutation<${dataType}, unknown, ${inputType}>(() => fetch(${pathLit} + (searchParams ? '?' + new URLSearchParams(searchParams) : ''), { method: '${methodName}', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(res => res.json())),`
	);
}

/**
 * Builds the code string for a dynamic child route (e.g., /users/[id]).
 * @param key - The key for the child in the parent object (e.g., 'USERS').
 * @param child - The child route node.
 * @param segments - The current path segments.
 * @param depth - The depth of this child route.
 * @returns The code string for the dynamic child route.
 */
function buildDynamicChildCode(key: string, child: RouteNode, segments: string[], depth: number): string[] {
	let param: string;
	let type: string;
	if (child.segment.startsWith('[...') && child.segment.endsWith(']')) {
		param = child.segment.slice(4, -1);
		type = 'string[]';
	} else {
		param = child.segment.slice(1, -1);
		type = 'string';
	}
	const childCode = buildObjectCode(child, [...segments, child.segment], depth + 1);
	const innerLines = childCode.split('\n').slice(1, -1);

	return [`${key.toUpperCase()}: (${param}: ${type}) => ({`, ...innerLines, `}),`];
}

/**
 * Builds the code string for a static child route (e.g., /users/profile).
 * @param key - The key for the child in the parent object (e.g., 'PROFILE').
 * @param child - The child route node.
 * @param segments - The current path segments.
 * @param depth - The depth of this child route.
 * @returns The code string for the static child route.
 */
function buildStaticChildCode(key: string, child: RouteNode, segments: string[], depth: number): string {
	const childCode = buildObjectCode(child, [...segments, child.segment], depth + 1);
	return `${key.toUpperCase()}: ${childCode},`;
}

/**
 * Builds the SDK object code recursively for the given route node.
 * @param node - The route node to build the code for.
 * @param segments - The segments of the path accumulated so far.
 * @param depth - The depth of this route.
 * @returns The SDK object code string for the given route node.
 */
export function buildObjectCode(node: RouteNode, segments: string[] = [], depth: number = 1): string {
	const lines: string[] = ['{'];
	const pathLit = buildPathLiteral(segments);

	node.methods.forEach((methodInfo: MethodInfo) => {
		lines.push(buildMethodCode(methodInfo, pathLit));
	});

	Object.entries(node.children).forEach(([key, child]) => {
		if (child.segment.startsWith('[') && child.segment.endsWith(']')) {
			lines.push(...buildDynamicChildCode(key, child, segments, depth));
		} else {
			lines.push(buildStaticChildCode(key, child, segments, depth));
		}
	});

	lines.push('}');
	return lines.join('\n');
}
