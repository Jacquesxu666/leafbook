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
            <template v-if="library.available">
              <p>Last opened {{ formatDate(library.lastOpenedAt) }}</p>
              <div class="reading-progress">
                <progress
                  :value="library.readingProgress"
                  max="1"
                  :aria-label="`${library.title} reading progress`"
                />
                <span>{{ formatProgress(library.readingProgress) }}</span>
              </div>
              <p v-if="library.lastChapterTitle" class="last-chapter">
                Continue from {{ library.lastChapterTitle }}
              </p>
            </template>
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
        <button
          ref="leaveButton"
          class="secondary"
          :disabled="
            books.arrangementPending ||
            Boolean(books.arrangement) ||
            books.preparationPending ||
            Boolean(books.preparation) ||
            books.outputPending
          "
          @click="leaveReader"
        >
          ← Bookshelf
        </button>
        <div class="reader-title">
          <strong>{{ books.session?.title }}</strong>
          <div class="reading-progress">
            <progress
              :value="books.session?.readingProgress ?? 0"
              max="1"
              aria-label="Book reading progress"
            />
            <span>{{ formatProgress(books.session?.readingProgress ?? 0) }}</span>
          </div>
        </div>
        <div class="reader-actions">
          <button
            ref="searchButton"
            class="secondary"
            aria-controls="book-search-panel"
            :aria-expanded="searchOpen"
            :disabled="
              books.refreshing ||
              books.arrangementPending ||
              Boolean(books.arrangement) ||
              books.preparationPending ||
              Boolean(books.preparation) ||
              books.preparationRetryBlocked ||
              books.outputPending
            "
            :aria-describedby="
              books.refreshing
                ? 'book-refresh-in-progress'
                : books.preparationRetryBlocked
                  ? 'book-preparation-refresh-required'
                  : undefined
            "
            @click="toggleSearch"
          >
            Search
          </button>
          <button
            ref="contentsButton"
            class="secondary"
            aria-controls="book-contents"
            :aria-expanded="!navCollapsed"
            :disabled="localNavigationFrozen"
            :aria-describedby="localFreezeDescriptionId"
            @click="toggleContents"
          >
            Contents
          </button>
          <button
            class="secondary outline-toggle"
            aria-controls="chapter-outline"
            :aria-expanded="!outlineCollapsed"
            :disabled="localNavigationFrozen"
            :aria-describedby="localFreezeDescriptionId"
            @click="toggleOutline"
          >
            Outline
          </button>
          <button
            v-if="books.session?.navigationSource === 'summary'"
            ref="arrangeButton"
            class="secondary"
            :disabled="
              books.refreshing ||
              books.arrangementPending ||
              Boolean(books.arrangement) ||
              books.preparationRetryBlocked ||
              books.outputPending
            "
            :aria-describedby="
              books.refreshing
                ? 'book-refresh-in-progress'
                : books.preparationRetryBlocked
                  ? 'book-preparation-refresh-required'
                  : undefined
            "
            @click="books.beginArrangement"
          >
            {{ books.arrangementPending && !books.arrangement ? 'Opening…' : 'Arrange' }}
          </button>
          <button
            v-if="books.session?.navigationSource === 'inferred'"
            ref="prepareButton"
            class="secondary"
            :disabled="
              books.refreshing ||
              books.preparationPending ||
              Boolean(books.preparation) ||
              books.preparationRetryBlocked ||
              books.arrangementPending ||
              Boolean(books.arrangement) ||
              books.outputPending
            "
            :title="
              books.preparationRetryBlocked
                ? 'Inspect the book folder, then refresh before preparing again.'
                : undefined
            "
            :aria-describedby="
              books.refreshing
                ? 'book-refresh-in-progress'
                : books.preparationRetryBlocked
                  ? 'book-preparation-refresh-required'
                  : undefined
            "
            @click="openPreparation"
          >
            {{ books.preparationPending && !books.preparation ? 'Preparing…' : 'Prepare Book' }}
          </button>
          <button
            class="secondary"
            :disabled="
              books.refreshing ||
              books.arrangementPending ||
              Boolean(books.arrangement) ||
              books.preparationPending ||
              Boolean(books.preparation) ||
              books.preparationRetryBlocked ||
              books.exportCancelRequested ||
              books.websitePending
            "
            :aria-describedby="
              books.refreshing
                ? 'book-refresh-in-progress'
                : books.preparationRetryBlocked
                  ? 'book-preparation-refresh-required'
                  : undefined
            "
            @click="books.exportPending ? books.cancelExport() : books.exportBook()"
          >
            {{
              books.exportCancelRequested
                ? 'Cancellation requested'
                : books.exportPending
                  ? 'Cancel export'
                  : 'Export…'
            }}
          </button>
          <button
            class="secondary"
            :disabled="
              books.refreshing ||
              books.arrangementPending ||
              Boolean(books.arrangement) ||
              books.preparationPending ||
              Boolean(books.preparation) ||
              books.preparationRetryBlocked ||
              books.websiteCancelRequested ||
              books.exportPending
            "
            :aria-describedby="
              books.refreshing
                ? 'book-refresh-in-progress'
                : books.preparationRetryBlocked
                  ? 'book-preparation-refresh-required'
                  : undefined
            "
            @click="books.websitePending ? books.cancelWebsite() : books.generateWebsite()"
          >
            {{
              books.websiteCancelRequested
                ? 'Cancellation requested'
                : books.websitePending
                  ? 'Cancel website'
                  : 'Generate Website…'
            }}
          </button>
          <button
            class="secondary"
            :disabled="
              !books.chapter ||
              books.refreshing ||
              books.arrangementPending ||
              Boolean(books.arrangement) ||
              books.preparationPending ||
              Boolean(books.preparation) ||
              books.preparationRetryBlocked ||
              books.outputPending
            "
            :aria-describedby="
              books.refreshing
                ? 'book-refresh-in-progress'
                : books.preparationRetryBlocked
                  ? 'book-preparation-refresh-required'
                  : undefined
            "
            @click="books.editCurrentChapter"
          >
            Edit
          </button>
          <button
            ref="refreshButton"
            class="secondary"
            :disabled="
              books.refreshing ||
              books.arrangementPending ||
              Boolean(books.arrangement) ||
              books.preparationPending ||
              Boolean(books.preparation) ||
              books.outputPending
            "
            :aria-describedby="books.refreshing ? 'book-refresh-in-progress' : undefined"
            @click="books.refresh"
          >
            {{ books.refreshing ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>
      </header>
      <book-search-panel
        v-if="searchOpen && !books.outputPending"
        :query="books.searchQuery"
        :results="books.searchResults"
        :loading="books.searchLoading"
        :progress="books.searchProgress"
        :index-status="books.searchIndexStatus"
        :total-results="books.searchTotalResults"
        :truncated="books.searchTruncated"
        :error="books.searchError"
        @query="books.scheduleSearch"
        @activate="activateSearchResult"
        @close="closeSearch"
      />
      <p
        v-if="
          books.error &&
          !books.preparationRetryBlocked &&
          !books.preparationStatus &&
          !(books.preparation && books.preparationError)
        "
        class="error-banner reader-error"
        role="alert"
      >
        {{ books.error.message }}
      </p>
      <p v-if="books.exportSuccess" class="state-message export-status" role="status">
        {{ books.exportSuccess }}
      </p>
      <p v-if="books.exportPending" class="state-message export-status" role="status">
        {{
          books.exportCancelRequested
            ? 'Cancellation requested. If the Save dialog is open, close it to finish cancelling.'
            : 'Preparing export. Cancel is available.'
        }}
      </p>
      <p v-if="books.websiteSuccess" class="state-message export-status" role="status">
        {{ books.websiteSuccess }}
      </p>
      <p v-if="books.websitePending" class="state-message export-status" role="status">
        {{
          books.websiteCancelRequested
            ? 'Cancellation requested. If the Save dialog is open, close it to finish cancelling.'
            : 'Generating an offline website. Cancel is available.'
        }}
      </p>
      <p
        v-if="books.refreshing"
        id="book-refresh-in-progress"
        class="state-message export-status"
        role="status"
      >
        Refreshing this book. Current book actions are unavailable until refresh finishes.
      </p>
      <p
        v-if="books.preparationStatus && !books.refreshing"
        :id="books.preparationRetryBlocked ? 'book-preparation-refresh-required' : undefined"
        class="state-message export-status"
        role="status"
      >
        {{ books.preparationStatus }}
      </p>
      <p
        v-if="books.preparationRetryBlocked && !books.preparationStatus && !books.refreshing"
        id="book-preparation-refresh-required"
        class="state-message export-status"
      >
        SUMMARY may have been created. Inspect the book folder, then refresh before preparing again.
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
          <book-arrangement-panel
            v-if="books.arrangement"
            :arrangement="books.arrangement"
            :error="books.arrangementError"
            :busy="books.arrangementPending"
            :apply-operation="books.applyArrangement"
            :undo-operation="books.undoArrangement"
            @save="books.saveArrangement"
            @cancel="books.closeArrangement"
          />
          <book-preparation-panel
            v-else-if="books.preparation"
            :preparation="books.preparation"
            :error="books.preparationError"
            :busy="books.preparationPending"
            @select="books.selectPreparationSource"
            @edit-draft="books.schedulePreparationDraft"
            @restore-draft="books.resolvePreparationRecovery(true)"
            @discard-recovery="books.resolvePreparationRecovery(false)"
            @discard-current-draft="books.discardCurrentPreparationDraft"
            @create="commitPreparation"
            @cancel="closePreparation"
          />
          <template v-else>
            <p class="panel-label">Contents · {{ books.session?.navigationSource }}</p>
            <button
              v-if="books.session?.landingNodeId"
              class="root-landing"
              :aria-current="
                books.chapter?.nodeId === books.session.landingNodeId ? 'page' : undefined
              "
              :disabled="books.refreshing || books.preparationRetryBlocked"
              :aria-describedby="
                books.refreshing
                  ? 'book-refresh-in-progress'
                  : books.preparationRetryBlocked
                    ? 'book-preparation-refresh-required'
                    : undefined
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
                :disabled="books.refreshing || books.preparationRetryBlocked"
                :described-by="
                  books.refreshing
                    ? 'book-refresh-in-progress'
                    : books.preparationRetryBlocked
                      ? 'book-preparation-refresh-required'
                      : undefined
                "
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
          </template>
        </nav>

        <main
          ref="contentElement"
          class="book-content"
          tabindex="-1"
          :aria-busy="!books.readingPositionReady"
          :aria-describedby="books.refreshing ? 'book-refresh-in-progress' : undefined"
          :data-reading-ready="books.readingPositionReady ? 'true' : 'false'"
          @scroll.passive="handleReaderScroll"
        >
          <p v-if="books.loading && !books.refreshing" class="state-message" role="status">
            Loading chapter…
          </p>
          <div v-else-if="books.chapter" class="chapter-wrap">
            <!-- Sanitized by renderBookMarkdown immediately before assignment. -->
            <!-- eslint-disable vue/no-v-html -->
            <article
              ref="chapterArticle"
              class="leafbook-markdown markdown-body"
              @pointerdown="handleContentPointerdown"
              @click="handleContentClick"
              @keydown="handleContentKeydown"
              @focusin="handleContentFocusin"
              v-html="rendered.html"
            />
            <!-- eslint-enable vue/no-v-html -->
            <footer class="chapter-navigation">
              <button
                class="secondary"
                :disabled="
                  !books.previousNodeId ||
                  books.refreshing ||
                  books.arrangementPending ||
                  Boolean(books.arrangement) ||
                  books.preparationPending ||
                  Boolean(books.preparation) ||
                  books.preparationRetryBlocked ||
                  books.outputPending
                "
                :aria-describedby="
                  books.refreshing
                    ? 'book-refresh-in-progress'
                    : books.preparationRetryBlocked
                      ? 'book-preparation-refresh-required'
                      : undefined
                "
                @click="navigatePrevious"
              >
                ← Previous
              </button>
              <button
                class="secondary"
                :disabled="
                  !books.nextNodeId ||
                  books.refreshing ||
                  books.arrangementPending ||
                  Boolean(books.arrangement) ||
                  books.preparationPending ||
                  Boolean(books.preparation) ||
                  books.preparationRetryBlocked ||
                  books.outputPending
                "
                :aria-describedby="
                  books.refreshing
                    ? 'book-refresh-in-progress'
                    : books.preparationRetryBlocked
                      ? 'book-preparation-refresh-required'
                      : undefined
                "
                @click="navigateNext"
              >
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
            :aria-disabled="localNavigationFrozen ? 'true' : undefined"
            :aria-describedby="localFreezeDescriptionId"
            :tabindex="localNavigationFrozen ? -1 : undefined"
            @click="activateOutline($event, item.id)"
            @keydown.enter="activateOutline($event, item.id)"
            @keydown.space="activateOutline($event, item.id)"
            >{{ item.text }}</a
          >
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  reactive,
  ref,
  watch
} from 'vue'
import type { BookReaderNodeDto, BookSearchResultDto } from '@shared/types/bookReader'
import { useBooksStore } from '@/store/books'
import { renderBookMarkdown, type RenderedBookChapter } from '@/book/renderMarkdown'
import { BookImageHydrator } from '@/book/hydrateBookImages'
import { restoreReadingPosition, waitForPaint } from '@/book/restoreReadingPosition'
import { bookFragmentKey } from 'common/book/heading'
import BookTreeNode from './BookTreeNode.vue'
import BookSearchPanel from './BookSearchPanel.vue'
import BookArrangementPanel from './BookArrangementPanel.vue'
import BookPreparationPanel from './BookPreparationPanel.vue'
import { focusAfterBookPreparation } from './bookPreparationFocus'
import {
  blockFrozenBookAnchorInteraction,
  createBookContentAnchorFreeze,
  redirectFrozenBookAnchorFocus,
  renderedBookAnchorAt
} from './bookContentAnchorFreeze'

const books = useBooksStore()
const navCollapsed = ref(false)
const outlineCollapsed = ref(false)
const contentElement = ref<HTMLElement | null>(null)
const chapterArticle = ref<HTMLElement | null>(null)
const leaveButton = ref<HTMLButtonElement | null>(null)
const contentsButton = ref<HTMLButtonElement | null>(null)
const prepareButton = ref<HTMLButtonElement | null>(null)
const arrangeButton = ref<HTMLButtonElement | null>(null)
const searchButton = ref<HTMLButtonElement | null>(null)
const refreshButton = ref<HTMLButtonElement | null>(null)
const searchOpen = ref(false)
const rendered = reactive<RenderedBookChapter>({ html: '', outline: [], resources: [] })
const localNavigationFrozen = computed(() => books.refreshing || books.preparationRetryBlocked)
const localFreezeDescriptionId = computed(() =>
  books.refreshing
    ? 'book-refresh-in-progress'
    : books.preparationRetryBlocked
      ? 'book-preparation-refresh-required'
      : undefined
)
const contentAnchorFreeze = createBookContentAnchorFreeze()
const bookImageHydrator = new BookImageHydrator()
const formatDate = (value: string): string => new Date(value).toLocaleDateString()
const formatProgress = (value: number): string => `${Math.round(value * 100)}%`
let restoreGeneration = 0
let restoringPosition = false
let unregisterReadingPositionProvider: (() => void) | null = null
let unregisterSearchProgress: (() => void) | null = null

const openPreparation = async (): Promise<void> => {
  if (books.refreshing || books.preparationRetryBlocked) return
  navCollapsed.value = false
  await nextTick()
  await books.beginPreparation()
}

const toggleContents = (): void => {
  if (localNavigationFrozen.value) return
  navCollapsed.value = !navCollapsed.value
}

const toggleOutline = (): void => {
  if (localNavigationFrozen.value) return
  outlineCollapsed.value = !outlineCollapsed.value
}

const closePreparation = async (): Promise<void> => {
  await books.closePreparation()
  await nextTick()
  prepareButton.value?.focus({ preventScroll: true })
}

const openSearch = (): void => {
  if (books.refreshing || books.preparationRetryBlocked) return
  books.clearTransientOperationFeedback()
  searchOpen.value = true
}

const commitPreparation = async (): Promise<void> => {
  const preparationId = books.preparation?.preparationId
  if (!preparationId) return
  await books.commitPreparation()
  if (
    books.preparation !== null ||
    books.preparationRetryBlocked ||
    books.preparationStatus === null
  ) {
    return
  }
  await nextTick()
  focusAfterBookPreparation({
    contentsButton: contentsButton.value,
    arrangeButton: arrangeButton.value
  })
}

watch(
  () =>
    books.refreshing ||
    books.arrangementPending ||
    books.preparationPending ||
    books.preparationRetryBlocked ||
    books.outputPending,
  (pending) => {
    if (pending) searchOpen.value = false
  }
)

const focusAfterFrozenContentAnchor = (): void => {
  const candidates = books.refreshing
    ? [leaveButton.value, refreshButton.value]
    : [refreshButton.value, leaveButton.value]
  const fallback = candidates.find((candidate) => candidate && !candidate.disabled)
  if (!fallback) {
    contentElement.value?.focus({ preventScroll: true })
    return
  }
  fallback?.focus({ preventScroll: true })
}

watch(
  [
    () => contentElement.value,
    () => rendered.html,
    () => localNavigationFrozen.value,
    () => localFreezeDescriptionId.value
  ],
  () => {
    contentAnchorFreeze.sync(
      contentElement.value,
      localNavigationFrozen.value,
      localFreezeDescriptionId.value
    )
    redirectFrozenBookAnchorFocus(
      contentElement.value,
      document.activeElement,
      localNavigationFrozen.value,
      focusAfterFrozenContentAnchor
    )
  },
  { flush: 'post', immediate: true }
)

const currentReadingRatio = (): number => {
  const element = contentElement.value
  if (!element) return 0
  const scrollable = Math.max(0, element.scrollHeight - element.clientHeight)
  return scrollable > 0 ? Math.min(1, Math.max(0, element.scrollTop / scrollable)) : 0
}
const handleReaderScroll = (): void => {
  if (
    books.mode !== 'reader' ||
    books.loading ||
    !books.session ||
    !books.chapter ||
    restoringPosition
  ) {
    return
  }
  books.reportReadingPosition(currentReadingRatio())
}
watch(
  [
    () => books.session?.sessionId,
    () => books.session?.resourceToken,
    () => books.chapter?.nodeId,
    () => books.chapter?.markdown,
    () => books.chapter?.fragment,
    () => books.mode
  ],
  async (_identity, _previous, onCleanup) => {
    bookImageHydrator.cancel()
    const chapter = books.chapter
    const generation = ++restoreGeneration
    const storeGeneration = books.beginReadingPositionRestore()
    const paintWaitController = new AbortController()
    restoringPosition = true
    let active = true
    const sessionId = books.session?.sessionId
    const nodeId = chapter?.nodeId
    onCleanup(() => {
      active = false
      paintWaitController.abort()
      bookImageHydrator.cancel()
      if (generation === restoreGeneration) {
        restoringPosition = false
      }
      books.cancelReadingPositionRestore(storeGeneration)
    })
    if (!chapter) {
      rendered.html = ''
      rendered.outline = []
      rendered.resources = []
      if (generation === restoreGeneration) {
        restoringPosition = false
      }
      books.cancelReadingPositionRestore(storeGeneration)
      return
    }
    await restoreReadingPosition({
      render: () => renderBookMarkdown(chapter.markdown),
      isCurrent: () =>
        active &&
        generation === restoreGeneration &&
        books.session?.sessionId === sessionId &&
        books.chapter?.nodeId === nodeId,
      mount: (result) => {
        rendered.html = result.html
        rendered.outline = result.outline
        rendered.resources = result.resources
      },
      waitForMount: nextTick,
      waitForPaint: () => waitForPaint(paintWaitController.signal),
      position: () => {
        if (chapter.fragment) {
          const decoded = bookFragmentKey(chapter.fragment)
          const heading = rendered.outline.find(
            (item) =>
              item.id === chapter.fragment ||
              bookFragmentKey(item.id) === decoded ||
              item.fragment === decoded
          )
          if (heading) scrollToHeading(heading.id, 'auto', true)
          else contentElement.value?.scrollTo({ top: 0 })
        } else {
          const element = contentElement.value
          if (element) {
            const scrollable = Math.max(0, element.scrollHeight - element.clientHeight)
            element.scrollTo({ top: scrollable * chapter.readingPosition })
          }
        }
      },
      sample: currentReadingRatio,
      complete: (ratio) => {
        const activeElement = document.activeElement
        if (!activeElement || activeElement === document.body) {
          contentElement.value?.focus({ preventScroll: true })
        }
        books.completeReadingPositionRestore(storeGeneration, ratio, Boolean(chapter.fragment))
        restoringPosition = false
      },
      fail: () => {
        rendered.html = ''
        rendered.outline = []
        rendered.resources = []
        books.error = {
          code: 'chapter-read-failed',
          message: 'LeafBook could not safely render this chapter.'
        }
      },
      release: () => {
        books.cancelReadingPositionRestore(storeGeneration)
        if (generation === restoreGeneration) restoringPosition = false
      }
    })
  },
  { immediate: true, flush: 'sync' }
)
const hydrateMountedBookImages = (): void => {
  const container = chapterArticle.value
  const session = books.session
  const chapter = books.chapter
  const generation = restoreGeneration
  if (
    !container ||
    !session ||
    !chapter ||
    !rendered.resources.length ||
    books.mode !== 'reader' ||
    !container.querySelector('img[data-leafbook-resource]')
  ) {
    return
  }
  bookImageHydrator
    .hydrate({
      container,
      sessionId: session.sessionId,
      resourceToken: session.resourceToken,
      nodeId: chapter.nodeId,
      resources: rendered.resources,
      readResource: window.electron.books.readResource,
      isCurrent: () =>
        generation === restoreGeneration &&
        books.mode === 'reader' &&
        books.session?.sessionId === session.sessionId &&
        books.session?.resourceToken === session.resourceToken &&
        books.chapter?.nodeId === chapter.nodeId
    })
    .catch(() => undefined)
}
onUpdated(hydrateMountedBookImages)
watch(
  () => books.refreshing,
  (refreshing) => {
    if (refreshing) bookImageHydrator.cancel()
  },
  { flush: 'sync' }
)
const handleContentClick = async (event: MouseEvent): Promise<void> => {
  const anchor = renderedBookAnchorAt(contentElement.value, event.target)
  if (!anchor) return
  if (blockFrozenBookAnchorInteraction(contentElement.value, event, localNavigationFrozen.value)) {
    return
  }
  event.preventDefault()
  const href = anchor.dataset.bookHref
  if (href) await books.followLink(href)
}
const handleContentKeydown = async (event: KeyboardEvent): Promise<void> => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const anchor = renderedBookAnchorAt(contentElement.value, event.target)
  if (!anchor) return
  if (blockFrozenBookAnchorInteraction(contentElement.value, event, localNavigationFrozen.value)) {
    return
  }
  event.preventDefault()
  const href = anchor.dataset.bookHref
  if (href) await books.followLink(href)
}
const handleContentPointerdown = (event: PointerEvent): void => {
  blockFrozenBookAnchorInteraction(contentElement.value, event, localNavigationFrozen.value)
}
const handleContentFocusin = (event: FocusEvent): void => {
  redirectFrozenBookAnchorFocus(
    contentElement.value,
    event.target,
    localNavigationFrozen.value,
    focusAfterFrozenContentAnchor
  )
}
const activateNavigationNode = async (node: BookReaderNodeDto): Promise<void> => {
  if (localNavigationFrozen.value) return
  await books.activateNode(node)
  if (window.matchMedia('(max-width: 700px)').matches) navCollapsed.value = true
}
const activateOutline = (event: MouseEvent | KeyboardEvent, id: string): void => {
  event.preventDefault()
  scrollToHeading(id)
}
const scrollToHeading = (
  id: string,
  behavior: 'auto' | 'smooth' = 'smooth',
  allowDuringRefresh = false
): void => {
  if (localNavigationFrozen.value && !(allowDuringRefresh && books.refreshing)) return
  const escaped =
    typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"')
  const container = contentElement.value
  const target = container?.querySelector<HTMLElement>(`#${escaped}`)
  if (!container || !target) return
  if (behavior === 'auto') {
    const top =
      container.scrollTop +
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top
    container.scrollTo({ top })
  } else {
    target.scrollIntoView({ behavior, block: 'start' })
  }
}
const keyboardNavigation = async (event: KeyboardEvent): Promise<void> => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return
  }
  if (event.key === 'Escape' && books.arrangement) {
    event.preventDefault()
    await books.closeArrangement()
    return
  }
  if (event.key === 'Escape' && books.preparation) {
    event.preventDefault()
    await closePreparation()
    return
  }
  if (event.key === 'Escape' && searchOpen.value) {
    event.preventDefault()
    await closeSearch()
    return
  }
  const target = event.target as HTMLElement | null
  if (
    event.key === '/' &&
    books.mode === 'reader' &&
    !books.outputPending &&
    !books.refreshing &&
    !books.preparationPending &&
    !books.preparation &&
    !books.preparationRetryBlocked &&
    !target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  ) {
    event.preventDefault()
    openSearch()
    return
  }
  if (event.key === 'Escape' && !navCollapsed.value && !localNavigationFrozen.value) {
    event.preventDefault()
    navCollapsed.value = true
    await nextTick()
    contentsButton.value?.focus()
    return
  }
  if (
    target?.closest(
      'button, a, [role="link"], input, textarea, select, [contenteditable]:not([contenteditable="false"])'
    )
  ) {
    return
  }
  if (
    !books.refreshing &&
    !books.preparationRetryBlocked &&
    event.key === 'ArrowLeft' &&
    books.previousNodeId
  ) {
    event.preventDefault()
    await navigatePrevious()
  } else if (
    !books.refreshing &&
    !books.preparationRetryBlocked &&
    event.key === 'ArrowRight' &&
    books.nextNodeId
  ) {
    event.preventDefault()
    await navigateNext()
  }
}
const navigatePrevious = async (): Promise<void> => {
  await books.previous()
}
const navigateNext = async (): Promise<void> => {
  await books.next()
}
const leaveReader = async (): Promise<void> => {
  searchOpen.value = false
  bookImageHydrator.cancel()
  await books.showBookshelf()
}
const toggleSearch = (): void => {
  if (books.refreshing || books.outputPending || books.preparationRetryBlocked) return
  if (searchOpen.value) closeSearch()
  else openSearch()
}
const closeSearch = async (): Promise<void> => {
  searchOpen.value = false
  await books.cancelSearch(false)
  await nextTick()
  searchButton.value?.focus()
}
const activateSearchResult = async (
  result: BookSearchResultDto,
  fragment: string | null
): Promise<void> => {
  searchOpen.value = false
  await books.openSearchResult(result, fragment)
}
onMounted(() => {
  unregisterReadingPositionProvider = books.registerReadingPositionProvider(() =>
    restoringPosition ||
    books.loading ||
    books.mode !== 'reader' ||
    !books.session ||
    !books.chapter
      ? null
      : currentReadingRatio()
  )
  unregisterSearchProgress = window.electron.books.onSearchProgress(books.handleSearchProgress)
  window.addEventListener('keydown', keyboardNavigation)
})
onBeforeUnmount(() => {
  bookImageHydrator.cancel()
  contentAnchorFreeze.restoreAll()
  books.closeArrangement().catch(() => undefined)
  books.closePreparation().catch(() => undefined)
  books.cancelExport().catch(() => undefined)
  books.cancelWebsite().catch(() => undefined)
  books.cancelSearch(false)
  books.flushReadingPosition().catch(() => undefined)
  unregisterReadingPositionProvider?.()
  unregisterSearchProgress?.()
  window.removeEventListener('keydown', keyboardNavigation)
})
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
  flex-wrap: wrap;
  justify-content: flex-end;
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
.reading-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--editorColor);
  font-size: 12px;
}
.reading-progress progress {
  width: min(150px, 28vw);
  height: 7px;
  accent-color: var(--themeColor);
}
.book-card .reading-progress {
  margin-top: 7px;
}
.book-card-info .last-chapter {
  min-height: 0;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  padding: 8px 14px;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--floatBorderColor);
  background: var(--titleBarBgColor);
  -webkit-app-region: drag;
}
.reader-header button {
  -webkit-app-region: no-drag;
}
.reader-title {
  display: grid;
  min-width: 160px;
  max-width: 420px;
  gap: 4px;
}
.reader-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reader-error {
  position: absolute;
  top: 62px;
  left: 50%;
  z-index: 4;
  transform: translateX(-50%);
}
.reader-grid {
  position: relative;
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
.leafbook-markdown :deep(.leafbook-local-image) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 1.25em auto;
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
    inset: 0 20% 0 0;
    z-index: 3;
    box-shadow: 10px 0 30px rgb(0 0 0 / 15%);
  }
}
</style>
