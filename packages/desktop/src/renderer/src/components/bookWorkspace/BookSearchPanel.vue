<!-- eslint-disable vue/html-self-closing, vue/max-attributes-per-line, vue/singleline-html-element-content-newline -->
<template>
  <section
    id="book-search-panel"
    class="search-panel"
    role="search"
    aria-label="Search this book"
    :aria-busy="loading"
    @keydown.esc.stop.prevent="$emit('close')"
  >
    <header>
      <label for="book-search-input">Search this book</label>
      <button type="button" class="close" aria-label="Close search" @click="$emit('close')">
        ×
      </button>
    </header>
    <input
      id="book-search-input"
      ref="inputElement"
      :value="query"
      type="search"
      maxlength="256"
      autocomplete="off"
      placeholder="Search words or phrases"
      aria-controls="book-search-results"
      @input="$emit('query', ($event.target as HTMLInputElement).value)"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="activateCurrent"
    />
    <div class="search-meta">
      <p class="search-status" aria-live="polite">
        <template v-if="loading">
          {{
            progress ? `${progress.phase} ${progress.completed} of ${progress.total}` : 'Searching…'
          }}
        </template>
        <template v-else-if="error">{{ error.message }}</template>
        <template v-else-if="query.trim()">
          {{ totalResults }} result{{ totalResults === 1 ? '' : 's' }}
          <span v-if="truncated">(showing the first {{ results.length }})</span>
        </template>
        <template v-else>Type up to eight words. Every word must match.</template>
      </p>
      <p v-if="indexStatus?.partial" class="partial-notice" role="status">
        <template v-if="indexStatus.omittedDocuments">
          Partial index: {{ indexStatus.omittedDocuments }} document{{
            indexStatus.omittedDocuments === 1 ? '' : 's'
          }}
          omitted.
        </template>
        <template v-else>Some document content was truncated to keep search bounded.</template>
      </p>
    </div>
    <div id="book-search-results" class="search-results" role="listbox" aria-label="Search results">
      <button
        v-for="(item, index) in items"
        :id="`book-search-result-${index}`"
        :key="`${item.result.nodeId}-${index}`"
        type="button"
        role="option"
        :aria-selected="activeIndex === index"
        :class="{ active: activeIndex === index }"
        @focus="activeIndex = index"
        @click="$emit('activate', item.result, item.match.fragment)"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="$emit('activate', item.result, item.match.fragment)"
      >
        <strong>{{ item.result.title }}</strong>
        <small>{{ item.result.breadcrumbs.join(' › ') }} · {{ item.match.kind }}</small>
        <span class="snippet">
          <template v-for="(segment, segmentIndex) in segments(item.match)" :key="segmentIndex">
            <mark v-if="segment.highlight">{{ segment.text }}</mark>
            <template v-else>{{ segment.text }}</template>
          </template>
        </span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type {
  BookReaderError,
  BookSearchIndexStatusDto,
  BookSearchMatchDto,
  BookSearchProgressDto,
  BookSearchResultDto
} from '@shared/types/bookReader'

const props = defineProps<{
  query: string
  results: BookSearchResultDto[]
  loading: boolean
  progress: BookSearchProgressDto | null
  indexStatus: BookSearchIndexStatusDto | null
  totalResults: number
  truncated: boolean
  error: BookReaderError | null
}>()
const emit = defineEmits<{
  query: [value: string]
  activate: [result: BookSearchResultDto, fragment: string | null]
  close: []
}>()
const inputElement = ref<HTMLInputElement | null>(null)
const activeIndex = ref(0)
const items = computed(() =>
  props.results.flatMap((result) => result.matches.map((match) => ({ result, match })))
)
watch(items, () => {
  activeIndex.value = 0
})
const focusItem = async (): Promise<void> => {
  await nextTick()
  document.getElementById(`book-search-result-${activeIndex.value}`)?.focus()
}
const move = (amount: number): void => {
  if (!items.value.length) return
  activeIndex.value = (activeIndex.value + amount + items.value.length) % items.value.length
  focusItem()
}
const activateCurrent = (): void => {
  const item = items.value[activeIndex.value]
  if (item) emit('activate', item.result, item.match.fragment)
}
const segments = (match: BookSearchMatchDto): Array<{ text: string; highlight: boolean }> => {
  const ranges = [...match.highlights]
    .filter(
      (range) => range.start >= 0 && range.end > range.start && range.end <= match.snippet.length
    )
    .sort((left, right) => left.start - right.start)
  const output: Array<{ text: string; highlight: boolean }> = []
  let offset = 0
  for (const range of ranges) {
    if (range.start < offset) continue
    if (range.start > offset) {
      output.push({ text: match.snippet.slice(offset, range.start), highlight: false })
    }
    output.push({ text: match.snippet.slice(range.start, range.end), highlight: true })
    offset = range.end
  }
  if (offset < match.snippet.length) {
    output.push({ text: match.snippet.slice(offset), highlight: false })
  }
  return output
}
onMounted(() => inputElement.value?.focus())
</script>

<style scoped>
.search-panel {
  position: absolute;
  top: 62px;
  right: 18px;
  z-index: 8;
  display: grid;
  grid-template-rows: auto 42px auto minmax(0, 1fr);
  width: min(460px, calc(100vw - 36px));
  max-height: min(680px, calc(100vh - 90px));
  gap: 10px;
  padding: 16px;
  overflow: hidden;
  border: 1px solid var(--floatBorderColor);
  border-radius: 12px;
  box-sizing: border-box;
  color: var(--editorColor);
  background: var(--sideBarBgColor);
  box-shadow: 0 16px 45px rgb(0 0 0 / 22%);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
}
.close {
  appearance: none;
  padding: 2px 9px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 7px;
  color: var(--editorColor);
  background: var(--editorBgColor);
  font-size: 22px;
}
input {
  height: 42px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 8px;
  box-sizing: border-box;
  color: var(--editorColor);
  background: var(--editorBgColor);
  font: inherit;
  line-height: 20px;
}
input:focus {
  outline: 2px solid var(--themeColor);
  outline-offset: 1px;
}
.search-status,
.partial-notice {
  margin: 0;
  font-size: 12px;
  opacity: 0.75;
}
.search-meta {
  display: grid;
  gap: 4px;
}
.partial-notice {
  color: #b67823;
}
.search-results {
  display: grid;
  grid-auto-rows: minmax(68px, auto);
  align-content: start;
  min-height: 0;
  gap: 7px;
  overflow: auto;
}
.search-results button {
  appearance: none;
  display: grid;
  min-height: 68px;
  max-height: 160px;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  box-sizing: border-box;
  color: var(--editorColor);
  background: transparent;
  text-align: left;
}
.search-results button.active,
.search-results button:focus-visible {
  background: color-mix(in srgb, var(--themeColor) 12%, transparent);
  outline: 2px solid var(--themeColor);
}
small {
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.65;
  white-space: nowrap;
}
.snippet {
  display: -webkit-box;
  overflow: hidden;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
mark {
  color: inherit;
  background: color-mix(in srgb, var(--themeColor) 35%, transparent);
}
@media (max-width: 700px) {
  .search-panel {
    inset: 57px 0 0;
    width: 100%;
    max-height: none;
    border-radius: 0;
  }
  .search-results {
    min-height: 0;
    overscroll-behavior: contain;
  }
}
</style>
