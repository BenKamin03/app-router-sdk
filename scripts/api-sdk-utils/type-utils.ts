import { SyntaxKind } from 'ts-morph';
import type { SourceFile, FunctionDeclaration, ArrowFunction, Signature, CallExpression } from 'ts-morph';
import type { MethodInfo } from './types.ts';

/**
 * Determines the input type for a method, looking for Zod schema usage.
 * @param handlerNode - The handler node
 * @returns The input type
 */
export function determineInputType(handlerNode: FunctionDeclaration | ArrowFunction | undefined): string {
    if (!handlerNode) return 'unknown';

    const params = handlerNode.getParameters();
    const reqParam = params.length > 0 ? params[0] : undefined;
    if (!reqParam) return 'unknown';

    const bodyVars = new Set<string>();
    handlerNode.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach((varDecl) => {
        const init = varDecl.getInitializer();
        let callExpr: CallExpression | undefined;
        if (init?.getKind() === SyntaxKind.CallExpression) {
            callExpr = init.asKind(SyntaxKind.CallExpression)!;
        } else if (init?.getKind() === SyntaxKind.AwaitExpression) {
            const awaitExpr = init.asKind(SyntaxKind.AwaitExpression)!;
            const inner = awaitExpr.getExpression();
            if (inner.isKind(SyntaxKind.CallExpression)) callExpr = inner as CallExpression;
        }
        if (callExpr) {
            const exprText = callExpr.getExpression().getText();
            if (exprText === `${reqParam.getName()}.json` || exprText === `${reqParam.getName()}.body`) {
                bodyVars.add(varDecl.getName());
            }
        }
    });

    const zodMethods = ['parse', 'parseAsync', 'safeParse'];
    for (const callExp of handlerNode.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = callExp.getExpression();
        if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
            const pae = expr.asKind(SyntaxKind.PropertyAccessExpression)!;
            const methodName = pae.getName();
            if (zodMethods.includes(methodName)) {
                const args = callExp.getArguments();
                if (
                    args.length > 0 &&
                    args[0].getKind() === SyntaxKind.Identifier &&
                    bodyVars.has(args[0].getText())
                ) {
                    const schemaExpr = pae.getExpression();
                    const typeArgs = schemaExpr.getType().getTypeArguments();
                    if (typeArgs.length > 0) {
                        const parsedType = typeArgs[typeArgs.length - 1];
                        return parsedType.getText();
                    }
                }
            }
        }
    }

    for (const callExp of handlerNode.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const fnExpr = callExp.getExpression();
        if (fnExpr.isKind(SyntaxKind.Identifier)) {
            const fnName = fnExpr.getText();
            const fnDecl = handlerNode
                .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
                .find((d) => d.getName() === fnName && d.getInitializer()?.isKind(SyntaxKind.ArrowFunction));
            const arrow = fnDecl?.getInitializerIfKind(SyntaxKind.ArrowFunction);
            if (arrow) {
                const param = arrow.getParameters()[0];
                const typeNode = param.getTypeNode();
                if (typeNode && callExp.getArguments().some((arg) => bodyVars.has(arg.getText()))) {
                    return typeNode.getText();
                }
            }
        }
    }

    return 'unknown';
}

/**
 * Determines the return type for a method, handling Promises and Response wrappers.
 * @param sourceFile - The source file containing the method
 * @param info - The method info
 * @param handlerNode - The handler node
 * @returns The return type
 */
export function determineReturnType(
    sourceFile: SourceFile,
    info: MethodInfo,
    handlerNode: FunctionDeclaration | ArrowFunction | undefined
): string {
    let sig: Signature | undefined;
    const varDecl = sourceFile.getVariableDeclaration(info.name);

    if (varDecl) {
        const arrow = varDecl.getInitializerIfKind(SyntaxKind.ArrowFunction);
        if (arrow) sig = arrow.getType().getCallSignatures()[0];
    }
    if (!sig && handlerNode?.isKind(SyntaxKind.FunctionDeclaration)) {
        sig = handlerNode.getSignature();
    }

    if (!sig) return info.returnType || 'unknown';

    let retType = sig.getReturnType();

    if (retType.getSymbol()?.getName() === 'Promise') {
        const args = retType.getTypeArguments();
        if (args.length === 1) retType = args[0];
    }

    if (['NextResponse', 'Response'].includes(retType.getSymbol()?.getName() || '')) {
        if (handlerNode) {
            const retStmts = handlerNode.getDescendantsOfKind(SyntaxKind.ReturnStatement);
            for (const retStmt of retStmts) {
                const expr = retStmt.getExpression();

                if (expr?.isKind(SyntaxKind.NewExpression)) {
                    const newExpr = expr.asKind(SyntaxKind.NewExpression)!;
                    if (['NextResponse', 'Response'].includes(newExpr.getExpression().getText())) {
                        const args = newExpr.getArguments();
                        if (args.length > 0) {
                            const firstArg = args[0];

                            if (firstArg.isKind(SyntaxKind.CallExpression)) {
                                const callExp = firstArg.asKind(SyntaxKind.CallExpression)!;
                                if (callExp.getExpression().getText() === 'JSON.stringify') {
                                    const [bodyArg] = callExp.getArguments();
                                    if (bodyArg) {
                                        return bodyArg.getType().getText();
                                    }
                                }
                            } else {
                                return firstArg.getType().getText();
                            }
                        }
                    }
                } else if (expr?.isKind(SyntaxKind.CallExpression)) {
                    const callExpr = expr.asKind(SyntaxKind.CallExpression)!;
                    if (
                        callExpr.getExpression().getText() === 'NextResponse.json' ||
                        callExpr.getExpression().getText() === 'Response.json'
                    ) {
                        const args = callExpr.getArguments();
                        if (args.length > 0) {
                            return args[0].getType().getText();
                        }
                    }
                }
            }
        }
    }

    return retType.getText();
}

/**
 * Refines the input and return types of methods using ts-morph analysis.
 * @param sourceFile - The source file containing the methods
 * @param methods - The methods to refine
 */
export function refineMethodTypes(sourceFile: SourceFile, methods: MethodInfo[]): void {
    methods.forEach((info) => {
        const handlerDecl = sourceFile.getVariableDeclaration(info.name);
        const handlerNode =
            handlerDecl?.getInitializerIfKind(SyntaxKind.ArrowFunction) ??
            sourceFile.getFunction(info.name);

        const inferred = determineInputType(handlerNode);
        info.inputType = inferred === 'unknown' && info.name === 'GET' ? 'void' : inferred;

        info.returnType = determineReturnType(sourceFile, info, handlerNode);
    });
} 