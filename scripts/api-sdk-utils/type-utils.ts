import { SyntaxKind } from 'ts-morph';
import type { SourceFile, FunctionDeclaration, ArrowFunction, Signature, CallExpression, BinaryExpression, PrefixUnaryExpression } from 'ts-morph';
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

    if (bodyVars.size > 0) {
        const props = new Set<string>();
        handlerNode.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).forEach((paeNode) => {
            const pae = paeNode.asKind(SyntaxKind.PropertyAccessExpression)!;
            const expr = pae.getExpression();
            if (expr.isKind(SyntaxKind.Identifier) && bodyVars.has(expr.getText())) {
                props.add(pae.getName());
            }
        });
        if (props.size > 0) {
            const stringMethods = new Set<string>([
                'split','trim','toUpperCase','toLowerCase','includes','startsWith','endsWith',
                'slice','substr','substring','match','replace','concat','padStart','padEnd',
                'charAt','charCodeAt','codePointAt','search'
            ]);
            const numberMethods = new Set<string>([
                'toFixed','toExponential','toPrecision','valueOf'
            ]);
            const arrayMethods = new Set<string>([
                'map','filter','reduce','forEach','some','every','find','findIndex','slice','concat',
                'push','pop','shift','unshift','includes','indexOf','lastIndexOf','reverse','sort',
                'fill','copyWithin'
            ]);
            const propTypes: Record<string, string> = {};

            props.forEach((propName) => {
                const usages = new Set<string>();
                // nested property access implies object (record)
                handlerNode.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).forEach((paeNode) => {
                    const paeInner = paeNode.asKind(SyntaxKind.PropertyAccessExpression)!;
                    const parentExpr = paeInner.getExpression();
                    if (parentExpr.isKind(SyntaxKind.PropertyAccessExpression)) {
                        const inner = parentExpr.asKind(SyntaxKind.PropertyAccessExpression)!;
                        if (
                            inner.getExpression().isKind(SyntaxKind.Identifier) &&
                            bodyVars.has(inner.getExpression().getText()) &&
                            inner.getName() === propName
                        ) {
                            usages.add('record');
                        }
                    }
                });
                // detect element access: numeric index => array, else => record
                handlerNode.getDescendantsOfKind(SyntaxKind.ElementAccessExpression).forEach((eaNode) => {
                    const ea = eaNode.asKind(SyntaxKind.ElementAccessExpression)!;
                    const expr = ea.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
                    const arg = ea.getArgumentExpression();
                    if (
                        expr &&
                        expr.getExpression().isKind(SyntaxKind.Identifier) &&
                        bodyVars.has(expr.getExpression().getText()) &&
                        expr.getName() === propName
                    ) {
                        if (arg?.isKind(SyntaxKind.NumericLiteral)) {
                            usages.add('array');
                        } else {
                            usages.add('record');
                        }
                    }
                });
                handlerNode.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).forEach((paeNode) => {
                    const pae = paeNode.asKind(SyntaxKind.PropertyAccessExpression)!;
                    const expr = pae.getExpression();

                    // direct numeric operations
                    if (expr.isKind(SyntaxKind.Identifier)
                        && bodyVars.has(expr.getText())
                        && pae.getName() === propName) {
                        const bin = paeNode.getParent()?.asKind(SyntaxKind.BinaryExpression);
                        if (bin) {
                            const op = bin.getOperatorToken().getText();
                            if (['*','/','-','%','**'].includes(op)) {
                                usages.add('number');
                            } else if (op === '+') {
                                const other = bin.getLeft() === paeNode ? bin.getRight() : bin.getLeft();
                                if (other?.isKind(SyntaxKind.NumericLiteral)) usages.add('number');
                                else if (other?.isKind(SyntaxKind.StringLiteral)) usages.add('string');
                                else usages.add('unknown');
                            }
                        }
                    }
                    // method-call based inference
                    const call = paeNode.getParent()?.asKind(SyntaxKind.CallExpression);
                    if (call && call.getExpression() === paeNode) {
                        const inner = pae.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
                        if (inner) {
                            const obj = inner.getExpression();
                            if (obj.isKind(SyntaxKind.Identifier)
                                && bodyVars.has(obj.getText())
                                && inner.getName() === propName) {
                                const method = pae.getName();
                                if (stringMethods.has(method)) usages.add('string');
                                else if (numberMethods.has(method)) usages.add('number');
                                else if (arrayMethods.has(method)) usages.add('array');
                            }
                        }
                    }
                });
                // detect boolean comparisons and logical usage
                handlerNode.getDescendantsOfKind(SyntaxKind.BinaryExpression).forEach((binNode) => {
                    const bin = binNode.asKind(SyntaxKind.BinaryExpression)!;
                    const op = bin.getOperatorToken().getText();
                    if (['==','===','!=','!==','&&','||'].includes(op)) {
                        [bin.getLeft(), bin.getRight()].forEach((side) => {
                            const pa = side.asKind(SyntaxKind.PropertyAccessExpression);
                            if (
                                pa &&
                                pa.getExpression().isKind(SyntaxKind.Identifier) &&
                                bodyVars.has(pa.getExpression().getText()) &&
                                pa.getName() === propName
                            ) {
                                usages.add('boolean');
                            }
                        });
                    }
                });
                
                // detect unary not usage
                handlerNode.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression).forEach((unNode) => {
                    const un = unNode.asKind(SyntaxKind.PrefixUnaryExpression)!;
                    if (un.getOperatorToken() === SyntaxKind.ExclamationToken) {
                        const operand = un.getOperand();
                        const pa = operand.asKind(SyntaxKind.PropertyAccessExpression);
                        if (
                            pa &&
                            pa.getExpression().isKind(SyntaxKind.Identifier) &&
                            bodyVars.has(pa.getExpression().getText()) &&
                            pa.getName() === propName
                        ) {
                            usages.add('boolean');
                        }
                    }
                });

                let type: string;
                if (usages.has('array')) {
                    if (usages.has('number') && !usages.has('string')) type = 'number[]';
                    else if (usages.has('string') && !usages.has('number')) type = 'string[]';
                    else type = 'unknown[]';
                } else if (
                    usages.has('record') &&
                    !usages.has('array') &&
                    !usages.has('number') &&
                    !usages.has('string') &&
                    !usages.has('boolean')
                ) {
                    type = 'Record<string, unknown>';
                } else if (usages.has('boolean') && !usages.has('number') && !usages.has('string')) {
                    type = 'boolean';
                } else if (usages.has('number') && !usages.has('string')) {
                    type = 'number';
                } else if (usages.has('string') && !usages.has('number')) {
                    type = 'string';
                } else {
                    type = 'unknown';
                }
                propTypes[propName] = type;
            });
            const fields = Array.from(props).map(name => `${name}: ${propTypes[name]}`).join('; ');
            return `{ ${fields} }`;
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