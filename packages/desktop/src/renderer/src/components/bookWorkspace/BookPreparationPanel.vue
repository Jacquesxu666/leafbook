<!-- eslint-disable vue/max-attributes-per-line, vue/singleline-html-element-content-newline -->
<template>
  <section
    ref="panel"
    class="preparation-panel"
    aria-labelledby="book-preparation-title"
    tabindex="-1"
  >
    <p class="panel-label">Prepare book</p>
    <h2 id="book-preparation-title">Create a table of contents from headings</h2>
    <p>
      LeafBook will create a new <code>SUMMARY.md</code>. Your manuscript and other files will not
      be changed.
    </p>

    <label v-if="preparation.requiresSelection" for="preparation-source">Manuscript</label>
    <select
      v-if="preparation.requiresSelection"
      id="preparation-source"
      :disabled="busy"
      :value="selectedSource"
      @change="selectSource"
    >
      <option value="">Choose a manuscript…</option>
      <option
        v-for="candidate in preparation.candidates"
        :key="candidate.nodeId"
        :value="candidate.nodeId"
      >
        {{ candidate.displayLabel }} — {{ candidate.title }}
      </option>
    </select>

    <template v-if="preparation.chapters.length">
      <p>{{ preparation.chapters.length }} chapters found in {{ preparation.sourceTitle }}.</p>
      <ol aria-label="Prepared chapters">
        <li v-for="chapter in visibleChapters" :key="chapter.ordinal">
          {{ chapter.title }}
        </li>
      </ol>
      <p v-if="omittedChapterCount">
        Showing the first {{ visibleChapters.length }} chapters. {{ omittedChapterCount }} more
        chapters are ready and will be included.
      </p>
    </template>

    <p v-if="error" class="preparation-error" role="alert">
      {{ error.message }}
    </p>
    <p v-if="!error" class="sr-only" aria-live="polite">
      {{
        busy
          ? 'Preparing book.'
          : preparation.chapters.length
            ? `${preparation.chapters.length} chapters ready.`
            : 'Choose a manuscript.'
      }}
    </p>

    <div class="preparation-actions">
      <button class="secondary" :disabled="busy" @click="$emit('cancel')">Cancel</button>
      <button
        :disabled="busy || !preparation.revision || !preparation.chapters.length"
        @click="$emit('create')"
      >
        {{ busy ? 'Creating…' : 'Create SUMMARY.md' }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { BookPreparationDto, BookReaderError } from '@shared/types/bookReader'

const props = defineProps<{
  preparation: BookPreparationDto
  error: BookReaderError | null
  busy: boolean
}>()

const emit = defineEmits<{
  select: [sourceNodeId: string]
  create: []
  cancel: []
}>()

const panel = ref<HTMLElement | null>(null)
const selectedSource = ref('')
const visibleChapters = computed(() => props.preparation.chapters.slice(0, 200))
const omittedChapterCount = computed(
  () => props.preparation.chapters.length - visibleChapters.value.length
)

const selectSource = (event: Event): void => {
  const value = (event.target as HTMLSelectElement).value
  selectedSource.value = value
  if (value) emit('select', value)
}

onMounted(async () => {
  await nextTick()
  panel.value?.focus({ preventScroll: true })
})
</script>

<style scoped>
.preparation-panel {
  display: grid;
  gap: 12px;
  padding: 16px;
  outline: none;
}

.preparation-panel:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: -2px;
}

.preparation-panel h2,
.preparation-panel p {
  margin: 0;
}

.preparation-panel ol {
  max-height: min(42vh, 420px);
  margin: 0;
  padding-left: 24px;
  overflow: auto;
}

.preparation-panel select {
  max-width: 100%;
}

.preparation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preparation-error {
  color: var(--notificationErrorColor, #b42318);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
