<!-- eslint-disable vue/html-closing-bracket-newline, vue/html-indent, vue/max-attributes-per-line, vue/singleline-html-element-content-newline -->
<template>
  <div class="book-workspace">
    <section v-if="books.mode === 'bookshelf'" class="bookshelf" aria-labelledby="bookshelf-title">
      <header class="bookshelf-header">
        <div>
          <p class="eyebrow">LeafBook library</p>
          <h1 id="bookshelf-title">Your Markdown books</h1>
          <p>Open a folder and read its Markdown files as one continuous book.</p>
        </div>
        <div class="header-actions">
          <button class="secondary" @click="books.showEditor">Back to editor</button>
          <button @click="books.openPicker">Open Book…</button>
        </div>
      </header>
      <p v-if="books.error" class="error-banner" role="alert">
        {{ books.error.message }}
      </p>
      <p v-if="books.loading" class="state-message" role="status">Loading books…</p>
      <div v-else-if="!books.libraries.length" class="empty-state">
        <h2>No books yet</h2>
        <p>Select a folder containing Markdown files. LeafBook never moves or copies it.</p>
        <button @click="books.openPicker">Choose a book folder</button>
      </div>
      <ul v-else class="book-cards" aria-label="Bookshelf">
        <li v-for="library in books.libraries" :key="library.libraryId" class="book-card">
          <button
            class="book-cover"
            :disabled="!library.available"
            :aria-label="`Read ${library.title}`"
            @click="books.openLibrary(library.libraryId)"
          >
            <span aria-hidden="true">LB</span>
          </button>
          <div class="book-card-info">
            <h2>{{ library.title }}</h2>
            <p v-if="library.available">Last opened {{ formatDate(library.lastOpenedAt) }}</p>
            <p v-else class="unavailable">
              {{ library.error?.message }}
            </p>
            <div>
              <button
                class="text-button"
                :disabled="!library.available"
                @click="books.openLibrary(library.libraryId)"
              >
                Read
              </button>
              <button
                class="text-button danger"
                :aria-label="`Remove ${library.title} from bookshelf`"
                @click="books.removeLibrary(library.libraryId)"
              >
                Remove
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <div v-else class="reader">
      <header class="reader-header">
        <button class="secondary" @click="books.showBookshelf">← Bookshelf</button>
        <strong>{{ books.session?.title }}</strong>
        <div class="reader-actions">
          <button
            ref="contentsButton"
            class="secondary"
            aria-controls="book-contents"
            :aria-expanded="!navCollapsed"
            @click="navCollapsed = !navCollapsed"
          >
            Contents
          </button>
          <button
            class="secondary outline-toggle"
            aria-controls="chapter-outline"
            :aria-expanded="!outlineCollapsed"
            @click="outlineCollapsed = !outlineCollapsed"
          >
            Outline
          </button>
          <button class="secondary" @click="books.refresh">Refresh</button>
        </div>
      </header>
      <p v-if="books.error" class="error-banner reader-error" role="alert">
        {{ books.error.message }}
      </p>
      <div
        class="reader-grid"
        :class="{ 'without-nav': navCollapsed, 'without-outline': outlineCollapsed }"
      >
        <nav
          v-if="!navCollapsed"
          id="book-contents"
          class="book-navigation"
          aria-label="Book contents"
        >
          <p class="panel-label">Contents · {{ books.session?.navigationSource }}</p>
          <button
            v-if="books.session?.landingNodeId"
            class="root-landing"
            :aria-current="
              books.chapter?.nodeId === books.session.landingNodeId ? 'page' : undefined
            "
            @click="books.openNode(books.session.landingNodeId)"
          >
            Book home
          </button>
          <ul class="book-tree">
            <book-tree-node
              v-for="node in books.session?.nodes ?? []"
              :key="node.nodeId"
              :node="node"
              :current-node-id="books.chapter?.nodeId ?? null"
              @activate="activateNavigationNode"
            />
          </ul>
          <details v-if="books.session?.diagnostics.length" class="diagnostics">
            <summary>{{ books.session.diagnostics.length }} book notices</summary>
            <ul>
              <li
                v-for="(diagnostic, index) in books.session.diagnostics.slice(0, 20)"
                :key="`${diagnostic.code}-${index}`"
              >
                {{ diagnostic.message }}
              </li>
            </ul>
          </details>
        </nav>

        <main ref="contentElement" class="book-content" tabindex="-1">
          <p v-if="books.loading" class="state-message" role="status">Loading chapter…</p>
          <div v-else-if="books.chapter" class="chapter-wrap">
            <!-- Sanitized by renderBookMarkdown immediately before assignment. -->
            <!-- eslint-disable vue/no-v-html -->
            <article
              class="leafbook-markdown markdown-body"
              @click="handleContentClick"
              @keydown="handleContentKeydown"
              v-html="rendered.html"
            />
            <!-- eslint-enable vue/no-v-html -->
            <footer class="chapter-navigation">
              <button class="secondary" :disabled="!books.previousNodeId" @click="books.previous">
                ← Previous
              </button>
              <button class="secondary" :disabled="!books.nextNodeId" @click="books.next">
                Next →
              </button>
            </footer>
          </div>
          <div v-else class="empty-state">
            <h1>No readable chapter</h1>
            <p>Select a chapter from the contents.</p>
          </div>
        </main>

        <aside
          v-if="!outlineCollapsed"
          id="chapter-outline"
          class="chapter-outline"
          aria-label="Chapter outline"
        >
          <p class="panel-label">On this page</p>
          <p v-if="!rendered.outline.length">No headings</p>
          <a
            v-for="item in rendered.outline"
            :key="item.id"
            href="#"
            :style="{ paddingLeft: `${Math.max(0, item.level - 1) * 10}px` }"
            @click.prevent="scrollToHeading(item.id)"
            >{{ item.text }}</a
          >
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { BookReaderNodeDto } from '@shared/types/bookReader'
import { useBooksStore } from '@/store/books'
import { renderBookMarkdown, type RenderedBookChapter } from '@/book/renderMarkdown'
import BookTreeNode from './BookTreeNode.vue'

const books = useBooksStore()
const navCollapsed = ref(false)
const outlineCollapsed = ref(false)
const contentElement = ref<HTMLElement | null>(null)
const contentsButton = ref<HTMLButtonElement | null>(null)
const rendered = reactive<RenderedBookChapter>({ html: '', outline: [] })
const formatDate = (value: string): string => new Date(value).toLocaleDateString()

watch(
  () => books.chapter,
  async (chapter, _previous, onCleanup) => {
    let active = true
    const sessionId = books.session?.sessionId
    const nodeId = chapter?.nodeId
    onCleanup(() => {
      active = false
    })
    if (!chapter) {
      rendered.html = ''
      rendered.outline = []
      return
    }
    const result = await renderBookMarkdown(chapter.markdown)
    if (!active || books.session?.sessionId !== sessionId || books.chapter?.nodeId !== nodeId) {
      return
    }
    rendered.html = result.html
    rendered.outline = result.outline
    await nextTick()
    contentElement.value?.scrollTo({ top: 0 })
    if (chapter.fragment) {
      const decoded = chapter.fragment.toLocaleLowerCase()
      const heading = rendered.outline.find(
        (item) => item.id === chapter.fragment || item.text.toLocaleLowerCase() === decoded
      )
      if (heading) scrollToHeading(heading.id)
    }
    contentElement.value?.focus({ preventScroll: true })
  },
  { immediate: true }
)
const handleContentClick = async (event: MouseEvent): Promise<void> => {
  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[data-book-href]')
  if (!anchor) return
  event.preventDefault()
  const href = anchor.dataset.bookHref
  if (href) await books.followLink(href)
}
const handleContentKeydown = async (event: KeyboardEvent): Promise<void> => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const anchor = (event.target as Element | null)?.closest<HTMLElement>('a[data-book-href]')
  if (!anchor) return
  event.preventDefault()
  const href = anchor.dataset.bookHref
  if (href) await books.followLink(href)
}
const activateNavigationNode = async (node: BookReaderNodeDto): Promise<void> => {
  await books.activateNode(node)
  if (window.matchMedia('(max-width: 700px)').matches) navCollapsed.value = true
}
const scrollToHeading = (id: string): void => {
  const escaped =
    typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"')
  contentElement.value?.querySelector<HTMLElement>(`#${escaped}`)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  })
}
const keyboardNavigation = async (event: KeyboardEvent): Promise<void> => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return
  }
  if (event.key === 'Escape' && !navCollapsed.value) {
    event.preventDefault()
    navCollapsed.value = true
    await nextTick()
    contentsButton.value?.focus()
    return
  }
  const target = event.target as HTMLElement | null
  if (
    target?.closest(
      'button, a, [role="link"], input, textarea, select, [contenteditable]:not([contenteditable="false"])'
    )
  ) {
    return
  }
  if (event.key === 'ArrowLeft' && books.previousNodeId) {
    event.preventDefault()
    await books.previous()
  } else if (event.key === 'ArrowRight' && books.nextNodeId) {
    event.preventDefault()
    await books.next()
  }
}
onMounted(() => window.addEventListener('keydown', keyboardNavigation))
onBeforeUnmount(() => window.removeEventListener('keydown', keyboardNavigation))
</script>

<style scoped>
.book-workspace {
  position: fixed;
  inset: var(--titleBarHeight) 0 0;
  z-index: 20;
  color: var(--editorColor);
  background: var(--editorBgColor);
  font-family: var(--fontFamily);
}
button {
  border: 0;
  border-radius: 8px;
  padding: 9px 14px;
  color: var(--buttonPrimaryFontColor);
  background: var(--buttonPrimaryBgColor);
  cursor: pointer;
}
button:not(:disabled):hover,
button:not(:disabled):focus-visible {
  background: var(--buttonPrimaryBgColorHover);
  outline: 2px solid var(--themeColor);
  outline-offset: 2px;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  pointer-events: none;
}
.secondary,
.text-button {
  color: var(--editorColor);
  background: var(--sideBarBgColor);
}
.text-button {
  padding: 6px 8px;
}
.danger {
  color: #c84848;
}
.bookshelf {
  height: 100%;
  overflow: auto;
  padding: 7vh clamp(24px, 7vw, 100px);
  box-sizing: border-box;
}
.bookshelf-header,
.reader-header,
.header-actions,
.reader-actions,
.book-card,
.chapter-navigation {
  display: flex;
  align-items: center;
}
.bookshelf-header {
  justify-content: space-between;
  gap: 30px;
  margin-bottom: 46px;
}
.bookshelf-header h1 {
  margin: 3px 0 10px;
  font-size: clamp(32px, 5vw, 58px);
}
.eyebrow,
.panel-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.65;
}
.header-actions,
.reader-actions {
  gap: 10px;
}
.book-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 22px;
  padding: 0;
  list-style: none;
}
.book-card {
  gap: 18px;
  padding: 18px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 14px;
  background: var(--sideBarBgColor);
}
.book-cover {
  width: 76px;
  height: 104px;
  flex: none;
  font-family: Georgia, serif;
  font-size: 22px;
  background: linear-gradient(145deg, #487d63, #1e4534);
}
.book-card-info h2 {
  margin: 0 0 5px;
}
.book-card-info p {
  min-height: 34px;
  opacity: 0.7;
}
.unavailable,
.error-banner {
  color: #d05656;
}
.empty-state,
.state-message {
  margin: auto;
  padding: 50px;
  text-align: center;
}
.error-banner {
  padding: 10px 14px;
  border-radius: 8px;
  background: rgb(208 86 86 / 12%);
}
.reader {
  display: flex;
  height: 100%;
  flex-direction: column;
}
.reader-header {
  min-height: 56px;
  padding: 0 14px;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--floatBorderColor);
  background: var(--titleBarBgColor);
  -webkit-app-region: drag;
}
.reader-header button {
  -webkit-app-region: no-drag;
}
.reader-error {
  position: absolute;
  top: 62px;
  left: 50%;
  z-index: 4;
  transform: translateX(-50%);
}
.reader-grid {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) minmax(180px, 230px);
}
.reader-grid.without-nav {
  grid-template-columns: minmax(0, 1fr) minmax(180px, 230px);
}
.reader-grid.without-outline {
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
}
.reader-grid.without-nav.without-outline {
  grid-template-columns: minmax(0, 1fr);
}
.book-navigation,
.chapter-outline {
  overflow: auto;
  padding: 20px 14px;
  background: var(--sideBarBgColor);
}
.book-navigation {
  border-right: 1px solid var(--floatBorderColor);
}
.chapter-outline {
  border-left: 1px solid var(--floatBorderColor);
}
.book-tree,
.book-tree :deep(ul) {
  padding: 0;
  list-style: none;
}
.root-landing {
  width: 100%;
  text-align: left;
  color: var(--editorColor);
  background: transparent;
}
.chapter-outline a {
  display: block;
  margin: 8px 0;
  color: var(--editorColor);
  text-decoration: none;
  opacity: 0.72;
}
.chapter-outline a:hover,
.chapter-outline a:focus-visible {
  color: var(--themeColor);
  opacity: 1;
  outline: 2px solid var(--themeColor);
}
.book-content {
  min-width: 0;
  overflow: auto;
  scroll-behavior: smooth;
}
.chapter-wrap {
  max-width: 850px;
  margin: 0 auto;
  padding: clamp(36px, 7vw, 86px) clamp(24px, 7vw, 80px);
}
.leafbook-markdown {
  color: var(--editorColor);
  background: transparent;
}
.leafbook-markdown :deep(.leafbook-media-placeholder) {
  display: block;
  padding: 20px;
  border: 1px dashed var(--floatBorderColor);
  border-radius: 8px;
  text-align: center;
  opacity: 0.65;
}
.leafbook-markdown :deep(a[data-book-href]) {
  color: var(--themeColor);
  cursor: pointer;
  text-decoration: underline;
}
.chapter-navigation {
  justify-content: space-between;
  margin-top: 60px;
  padding-top: 22px;
  border-top: 1px solid var(--floatBorderColor);
}
.diagnostics {
  margin-top: 28px;
  font-size: 12px;
  opacity: 0.75;
}
.diagnostics ul {
  padding-left: 18px;
}
@media (max-width: 980px) {
  .outline-toggle {
    display: none;
  }
  .reader-grid,
  .reader-grid.without-outline {
    grid-template-columns: minmax(200px, 250px) minmax(0, 1fr);
  }
  .reader-grid.without-nav {
    grid-template-columns: 1fr;
  }
  .chapter-outline {
    display: none;
  }
}
@media (max-width: 700px) {
  .bookshelf-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .reader-header strong,
  .outline-toggle {
    display: none;
  }
  .reader-grid,
  .reader-grid.without-outline {
    grid-template-columns: 1fr;
  }
  .book-navigation {
    position: absolute;
    inset: 57px 20% 0 0;
    z-index: 3;
    box-shadow: 10px 0 30px rgb(0 0 0 / 15%);
  }
}
</style>
