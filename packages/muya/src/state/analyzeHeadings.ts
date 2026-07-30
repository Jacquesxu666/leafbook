import type { Heading } from '../utils/marked/types';
import { tokenizer, tokensToPlainText } from '../inlineRenderer/lexer';
import { lexBlock } from '../utils/marked';

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_HEADINGS = 2_000;
const DEFAULT_MAX_LINES = 250_000;

export interface IAtxH1Heading {
    ordinal: number;
    line: number;
    title: string;
}

export interface IAtxH1AnalysisLimits {
    maxBytes?: number;
    maxHeadings?: number;
    maxLines?: number;
}

export type AtxH1AnalysisError = 'source-too-large' | 'heading-limit' | 'line-limit';

export type IAtxH1AnalysisResult
    = | { ok: true; headings: IAtxH1Heading[] }
        | { ok: false; error: AtxH1AnalysisError };

function finiteLimit(value: number | undefined, fallback: number, maximum: number): number {
    return Number.isSafeInteger(value) && (value as number) > 0
        ? Math.min(value as number, maximum)
        : fallback;
}

function newlineCount(value: string): number {
    let count = 0;
    for (let index = 0; index < value.length; index++) {
        if (value.charCodeAt(index) === 10)
            count++;
    }
    return count;
}

function isAtxH1(token: unknown): token is Heading {
    return Boolean(
        token
        && typeof token === 'object'
        && (token as Partial<Heading>).type === 'heading'
        && (token as Partial<Heading>).headingStyle === 'atx'
        && (token as Partial<Heading>).depth === 1,
    );
}

/**
 * Analyze top-level ATX H1 blocks through Muya's block and inline tokenizers.
 *
 * This module is deliberately DOM-free so the Electron main process can use
 * the same visible-heading semantics without importing Muya's UI entry point.
 * It returns no source text or filesystem information.
 */
export function analyzeAtxH1Headings(
    markdown: string,
    requestedLimits: IAtxH1AnalysisLimits = {},
): IAtxH1AnalysisResult {
    const maxBytes = finiteLimit(requestedLimits.maxBytes, DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
    const maxHeadings = finiteLimit(
        requestedLimits.maxHeadings,
        DEFAULT_MAX_HEADINGS,
        DEFAULT_MAX_HEADINGS,
    );
    const maxLines = finiteLimit(requestedLimits.maxLines, DEFAULT_MAX_LINES, DEFAULT_MAX_LINES);

    if (new TextEncoder().encode(markdown).byteLength > maxBytes)
        return { ok: false, error: 'source-too-large' };

    const normalizedMarkdown = markdown.split('\r\n').join('\n').split('\r').join('\n');
    const totalLines = normalizedMarkdown.length === 0 ? 0 : newlineCount(normalizedMarkdown) + 1;
    if (totalLines > maxLines)
        return { ok: false, error: 'line-limit' };

    const headings: IAtxH1Heading[] = [];
    let line = 1;
    for (const token of lexBlock(normalizedMarkdown, {
        footnote: false,
        frontMatter: true,
        isGitlabCompatibilityEnabled: true,
        math: true,
        superSubScript: true,
    })) {
        if (isAtxH1(token)) {
            if (headings.length >= maxHeadings)
                return { ok: false, error: 'heading-limit' };
            const title = tokensToPlainText(tokenizer(token.text, {
                hasBeginRules: false,
                options: { superSubScript: true, footnote: false, parseHtmlAttributes: false },
            })).trim();
            headings.push({
                ordinal: headings.length + 1,
                line,
                title,
            });
        }
        line += newlineCount(token.raw);
    }
    return { ok: true, headings };
}
