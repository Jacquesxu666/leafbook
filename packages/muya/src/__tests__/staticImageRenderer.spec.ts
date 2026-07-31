import { describe, expect, it, vi } from 'vitest';
import { renderToStaticHTML } from '../state/renderToStaticHTML';

describe('renderToStaticHTML imageRenderer contract', () => {
    it('reports inline and reference Markdown images but not image-like text in inert token classes', () => {
        const imageRenderer = vi.fn(token => `<leafbook-image>${token.href}</leafbook-image>`);
        const markdown = [
            '![inline](images/inline.png)',
            '',
            '![reference][cover]',
            '',
            '`![code](images/code.png)`',
            '',
            '$![math](images/math.png)$',
            '',
            '^![sup](images/sup.png)^ and ~![sub](images/sub.png)~',
            '',
            '<img src="images/raw.png" alt="raw">',
            '',
            '[cover]: images/reference.webp',
        ].join('\n');

        const html = renderToStaticHTML(markdown, {
            imageRenderer,
            sanitize: false,
        });

        expect(imageRenderer.mock.calls.map(([token]) => token.href)).toEqual([
            'images/inline.png',
            'images/reference.webp',
        ]);
        expect(html).toContain('<leafbook-image>images/inline.png</leafbook-image>');
        expect(html).toContain('<leafbook-image>images/reference.webp</leafbook-image>');
    });
});
