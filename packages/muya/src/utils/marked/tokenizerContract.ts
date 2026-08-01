import type { MarkedExtension } from 'marked';

export interface ILeafBookMathToken {
    type: 'inlineMath' | 'multiplemath';
    raw: string;
    text: string;
    displayMode: boolean;
    mathStyle?: '' | 'gitlab';
}

export interface ILeafBookScriptToken {
    type: 'superscript' | 'subscript';
    raw: string;
    text: string;
    marker: '^' | '~';
}

export interface ILeafBookTokenizerContractOptions {
    math?: boolean;
    superSubScript?: boolean;
    renderMath?: (token: ILeafBookMathToken, block: boolean) => string;
    renderScript?: (token: ILeafBookScriptToken) => string;
}

const INLINE_MATH_START = /(\s|^)\${1,2}(?!\$)/;
const INLINE_MATH = /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\1(?=[\s?!.,:]|$)/;
const BLOCK_MATH = /^(\${1,2})\n((?:\\[\s\S]|[^\\])+?)\n\1[ \t]*(?:\n|$)/;
const SUB_START = /(?:\s|^)(~)(?!\1)/;
const SUB = /^(~)((?:[^~\s]|(?<=\\)\1|(?<=\\) )+?)(?<!\\)\1(?!\1)/;
const SUP_START = /(?:\S|^)(\^)(?!\1)/;
const SUP = /^(\^)((?:[^^\s]|(?<=\\)\1|(?<=\\) )+?)(?<!\\)\1(?!\1)/;

function defaultMathRenderer(token: ILeafBookMathToken, block: boolean): string {
    return token.type === 'inlineMath'
        ? `$${token.text}$`
        : `<pre class="multiple-math" data-math-style="${token.mathStyle ?? ''}">${token.text}</pre>${block ? '\n' : ''}`;
}

function defaultScriptRenderer(token: ILeafBookScriptToken): string {
    return token.marker === '^'
        ? `<sup>${token.text}</sup>`
        : `<sub>${token.text}</sub>`;
}

/**
 * The pure tokenizer contract shared by Muya static rendering and LeafBook's
 * main-process resource authorization pass. Keep token recognition here: the
 * module has no DOM, KaTeX, Prism, or renderer-runtime imports.
 */
export function leafBookTokenizerContract(
    options: ILeafBookTokenizerContractOptions = {},
): MarkedExtension {
    const extensions: NonNullable<MarkedExtension['extensions']> = [];
    if (options.math ?? true) {
        const render = options.renderMath ?? defaultMathRenderer;
        extensions.push(
            {
                name: 'inlineMath',
                level: 'inline',
                start(src: string) {
                    const match = src.match(INLINE_MATH_START);
                    if (!match)
                        return;
                    const index = (match.index ?? 0) + match[1].length;
                    return INLINE_MATH.test(src.substring(index)) ? index : undefined;
                },
                tokenizer(src: string) {
                    const match = src.match(INLINE_MATH);
                    if (!match)
                        return;
                    return {
                        type: 'inlineMath',
                        raw: match[0],
                        text: match[2].trim(),
                        displayMode: match[1].length === 2,
                    } satisfies ILeafBookMathToken;
                },
                renderer(token) {
                    return render(token as ILeafBookMathToken, false);
                },
            },
            {
                name: 'multiplemath',
                level: 'block',
                start(src: string) {
                    return src.indexOf('\n$');
                },
                tokenizer(src: string) {
                    const match = src.match(BLOCK_MATH);
                    if (!match)
                        return;
                    return {
                        type: 'multiplemath',
                        raw: match[0],
                        text: match[2].trim(),
                        displayMode: match[1].length === 2,
                        mathStyle: '',
                    } satisfies ILeafBookMathToken;
                },
                renderer(token) {
                    return render(token as ILeafBookMathToken, true);
                },
            },
        );
    }
    if (options.superSubScript ?? true) {
        const render = options.renderScript ?? defaultScriptRenderer;
        for (const name of ['superscript', 'subscript'] as const) {
            const startRule = name === 'superscript' ? SUP_START : SUB_START;
            const tokenRule = name === 'superscript' ? SUP : SUB;
            extensions.push({
                name,
                level: 'inline',
                start(src: string) {
                    const match = src.match(startRule);
                    if (!match)
                        return;
                    const index = (match.index ?? 0) + match[1].length;
                    return tokenRule.test(src.substring(index)) ? index : undefined;
                },
                tokenizer(src: string) {
                    const match = src.match(tokenRule);
                    if (!match)
                        return;
                    return {
                        type: name,
                        raw: match[0],
                        text: match[2].trim(),
                        marker: match[1] as '^' | '~',
                    } satisfies ILeafBookScriptToken;
                },
                renderer(token) {
                    return render(token as ILeafBookScriptToken);
                },
            });
        }
    }
    return { extensions };
}
