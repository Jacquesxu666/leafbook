export const LINUX_MARKDOWN_FILE_ASSOCIATIONS = Object.freeze(
  ['md', 'markdown', 'mmd', 'mdown', 'mdtxt', 'mdtext', 'mdx'].map((ext) =>
    Object.freeze({
      ext,
      name: 'Markdown',
      description: 'Markdown document',
      mimeType: 'text/markdown'
    })
  )
)
