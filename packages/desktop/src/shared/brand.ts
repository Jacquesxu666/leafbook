/**
 * Public LeafBook identity.
 *
 * Keep these values separate from internal MarkText/Muya identifiers so that
 * future upstream merges do not require broad, conflict-prone renames.
 */
export const APP_NAME = 'LeafBook'
export const APP_SLUG = 'leafbook'
export const APP_ID = 'com.jacquesxu.leafbook'
export const REPOSITORY_URL = 'https://github.com/Jacquesxu666/leafbook'
export const README_URL = `${REPOSITORY_URL}/blob/develop/README.md`
export const ISSUES_URL = `${REPOSITORY_URL}/issues`
export const DISCUSSIONS_URL = `${REPOSITORY_URL}/discussions`
export const RELEASES_URL = `${REPOSITORY_URL}/releases`
export const LICENSE_URL = `${REPOSITORY_URL}/blob/develop/LICENSE`

const inheritedDocsRoot =
  `${REPOSITORY_URL}/blob/develop/packages/website/content/docs/end-user`

/**
 * These manuals are inherited MarkText documentation carried in the fork.
 * README identifies their provenance until LeafBook-specific manuals replace them.
 */
export const DOCUMENTATION_URLS = {
  userGuide: `${inheritedDocsRoot}/BASICS.md`,
  markdownSyntax: `${inheritedDocsRoot}/MARKDOWN_SYNTAX.md`,
  keybindings: `${inheritedDocsRoot}/KEYBINDINGS.md`,
  images: `${inheritedDocsRoot}/IMAGES.md`,
  exportThemes: `${inheritedDocsRoot}/EXPORT_THEMES.md`
} as const

/**
 * LeafBook does not have a signed release channel yet. This must remain false
 * until packages are published from a LeafBook-owned, verified update feed.
 */
export const AUTO_UPDATE_ENABLED = false

/**
 * Replace the inherited public product name in locale data without renaming
 * internal translation keys. All shipped locales spell the product "MarkText".
 */
export function brandTranslations<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replaceAll('MarkText', APP_NAME) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => brandTranslations(item)) as T
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, brandTranslations(item)])
    ) as T
  }
  return value
}
