// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { analyzeAtxH1Headings } from '../analyzeHeadings';

describe('analyzeAtxH1Headings', () => {
    it('is Node-safe and returns only bounded evidence for top-level ATX H1 headings', () => {
        expect(globalThis).not.toHaveProperty('window');
        expect(globalThis).not.toHaveProperty('document');
        expect(analyzeAtxH1Headings([
            '# **First** and [link](https://example.invalid)',
            '',
            '> # quoted',
            '',
            'Setext',
            '======',
            '',
            '## H2',
            '',
            '# ![Logo](image.png) Final ###',
        ].join('\n'))).toEqual({
            ok: true,
            headings: [
                { ordinal: 1, line: 1, title: 'First and link' },
                { ordinal: 2, line: 10, title: 'Logo Final' },
            ],
        });
    });

    it('uses visible inline text for Unicode, escapes, code, and repeated titles', () => {
        const result = analyzeAtxH1Headings([
            '# 中文 **章节**',
            '# `code` &amp; \\*literal\\*',
            '# <span title="ignored">HTML</span>',
            '# Same',
            '# Same',
        ].join('\n'));
        expect(result).toEqual({
            ok: true,
            headings: [
                { ordinal: 1, line: 1, title: '中文 章节' },
                { ordinal: 2, line: 2, title: 'code & *literal*' },
                { ordinal: 3, line: 3, title: 'HTML' },
                { ordinal: 4, line: 4, title: 'Same' },
                { ordinal: 5, line: 5, title: 'Same' },
            ],
        });
    });

    it('does not surface fake headings inside fenced or indented code', () => {
        const result = analyzeAtxH1Headings([
            '```md',
            '# fenced',
            '```',
            '',
            '    # indented',
            '',
            '# Real',
        ].join('\n'));
        expect(result).toEqual({
            ok: true,
            headings: [{ ordinal: 1, line: 7, title: 'Real' }],
        });
    });

    it('accepts CRLF and rejects non-ATX forms', () => {
        expect(analyzeAtxH1Headings('#invalid\r\n\r\nTitle\r\n=====\r\n\r\n# Valid\r\n')).toEqual({
            ok: true,
            headings: [{ ordinal: 1, line: 6, title: 'Valid' }],
        });
    });

    it('fails closed at byte, line, and heading caps', () => {
        expect(analyzeAtxH1Headings('# 1234', { maxBytes: 5 })).toEqual({
            ok: false,
            error: 'source-too-large',
        });
        expect(analyzeAtxH1Headings('# One\n# Two', { maxLines: 1 })).toEqual({
            ok: false,
            error: 'line-limit',
        });
        expect(analyzeAtxH1Headings('# One\n# Two', { maxHeadings: 1 })).toEqual({
            ok: false,
            error: 'heading-limit',
        });
    });
});
