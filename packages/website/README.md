# LeafBook inherited documentation validation

`leafbook-docs-validation` is a quarantined validation package for documentation
and presentation code inherited from MarkText. It is kept in the LeafBook
monorepo so inherited documents can remain searchable and mechanically checked
while LeafBook establishes its own product experience.

This package is **not the LeafBook product website**. It has no production
server script, deployment script, public domain, release-download channel, or
approved hosting target. Never publish `.next/` or any other output from this
package. A future LeafBook website must be reviewed and introduced separately.

The site currently uses:

- Next.js 15.5.19
- React and React DOM 19.2.7
- TypeScript 5.9.3
- Tailwind CSS 4.3.1

`packages/website/package.json` is the source of truth for these dependency
versions.

## Requirements

Use the monorepo toolchain declared by the root `package.json`:

- Node.js 20.19.0 or newer
- pnpm 10 or newer

Install dependencies from the repository root:

```bash
pnpm install
```

## Local validation

Run these commands from the repository root.

For short-lived local inspection only, run the Next.js development server on
<http://localhost:3000>:

```bash
pnpm --filter leafbook-docs-validation run dev
```

Regenerate the documentation search index explicitly:

```bash
pnpm --filter leafbook-docs-validation run docs:index
```

The development command generates the index only when it is missing. A
production build always regenerates it through the package's `prebuild`
script.

Run the same validation used by the website workflow:

```bash
pnpm --filter leafbook-docs-validation run lint
pnpm --filter leafbook-docs-validation run type-check
pnpm --filter leafbook-docs-validation run build
```

Next.js writes validation output to `.next/`. There is intentionally no
`start`, preview, publish, deploy, Cloudflare, Wrangler, or GitHub Pages script.
Do not serve or deploy the build output.

## Project layout

```text
packages/website/
├── content/docs/       # Inherited end-user and developer documentation
├── public/             # Static assets and generated docs-index.json
├── scripts/            # Documentation index generation
├── src/app/            # Next.js App Router pages and styles
├── src/components/     # Site and documentation UI
├── src/hooks/          # Client-side React hooks
├── src/lib/            # Documentation parsing, navigation, and search
├── next.config.ts
├── package.json
└── tsconfig.json
```

## Deployment status

`.github/workflows/website-deploy.yml` is intentionally a read-only
documentation validation workflow. It installs dependencies, lints,
type-checks, and builds this quarantined package, but it has no deployment job
and no write permission.

LeafBook does not yet have a reviewed, project-owned website target. Do not
automatically deploy this fork, manually run an inherited deployment, or
publish its output anywhere. Deployment can be introduced only as a separate
LeafBook-owned product-site project after its target, credentials, content, and
public identity have been reviewed.

## License

LeafBook retains the inherited MarkText notices and license terms. See the
repository [LICENSE](../../LICENSE), [NOTICE](../../NOTICE), and
desktop [third-party notices](../desktop/build/THIRD-PARTY-LICENSES.txt).
