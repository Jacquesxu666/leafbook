# LeafBook Contributing Guide

Thank you for contributing to LeafBook. Before submitting your contribution,
please read these guidelines.

- [Code of Conduct](../packages/website/content/docs/dev/CODE_OF_CONDUCT.md)
- [Philosophy](#philosophy)
- [Issue reporting guidelines](#issue-reporting-guidelines)
- [Pull request guidelines](#pull-request-guidelines)
  - [Where should I start?](#where-should-i-start)
- [Quick start](#quick-start)
  - [Build instructions](#build-instructions)
  - [Style guide](#style-guide)
  - [Commenting guidelines](#commenting-guidelines)
- [Developer documentation](#developer-documentation)

## Philosophy

🔑 Our philosophy is to keep things clean, simple and minimal. 
LeafBook is a local-first Markdown book reader and editor. Changes should keep
the default interface focused while making a folder of Markdown documents feel
like a coherent book.

## Issue Reporting Guidelines

Please search for similar issues before opening an issue and always follow the
[issue template](ISSUE_TEMPLATE/). Please review the following Pull Request
guidelines before making your own PR.

## Pull Request Guidelines

**In *all* Pull Requests:** provide a detailed description of the problem, as well as a demonstration with screen recordings and/or screenshots.

Please make sure the following is done before submitting a PR:

- Submit PRs directly to the `develop` branch.
- Reference the related issue in the PR comment.
- Utilize [JSDoc](https://github.com/jsdoc/jsdoc) for better code documentation.
- Ensure all tests pass.
- Please lint (`pnpm run lint`) your PR.
- All PRs need to pass the **CI** before merged. If it fails, please try to solve the issue(s) and feel free to ask for any help.

If you add new feature:

- Open a suggestion issue first.
- Provide your reasoning on why you want to add this feature.
- Submit your PR.

If you fix a bug:

- If you are resolving a special issue, please add `fix: #<issue number> <short message>` in your PR title (e.g.`fix: #3899 update entities encoding/decoding`).
- Provide a detailed description of the bug in your PR and/or link to the issue. 

### Where should I start?

A good way to start is to find a
[LeafBook issue](https://github.com/Jacquesxu666/leafbook/issues) labeled
`bug`, `help wanted`, or `feature request`. Discuss larger changes first.

Other ways to help:

- Documentation
- Translation (currently unavailable)
- Design icons and logos
- Improve the UI
- Write tests for LeafBook
- Share missing features and bugs with the LeafBook project.

## Quick start

1. Fork the repository.
2. Clone your fork: `git clone git@github.com:<username>/leafbook.git`
3. Create a feature branch: `git checkout -b feature`
4. Make your changes and push your branch.
5. Create a PR against `develop` and describe your changes.

**Rebase your PR:**

If there are conflicts or you want to update your local branch, please do the following:

1. `git fetch upstream`
2. `git rebase upstream/develop`
3. Please [resolve](https://help.github.com/articles/resolving-merge-conflicts-after-a-git-rebase/) all conflicts and force push your feature branch: `git push -f`

### Build Instructions

🔗 [Build Instructions](../packages/website/content/docs/dev/BUILD.md)

### Style Guide

You can run ESLint (`pnpm run lint`) to help you to follow the style guide.

- ES6 and "best practices"
- 2 space indent
- no semicolons
- documentation: [JSDoc](https://github.com/jsdoc/jsdoc) 

### Commenting Guidelines

When writing comments, please follow our [Commenting Guidelines](./COMMENTING-GUIDELINES.md). In short: a comment should describe what isn't obvious from the code — the rationale, units, invariants, and abstractions — rather than restating it. Reviewers check new and changed comments against these guidelines.

## Developer Documentation

See the [inherited developer documentation](../packages/website/content/docs/dev/README.md).
These documents originated in MarkText and remain available in this fork while
LeafBook-specific documentation is developed.
