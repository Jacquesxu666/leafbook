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

    <div v-if="preparation.recovery" class="recovery-notice" role="status">
      <p v-if="preparation.recovery.status === 'available'">
        A saved preparation draft is available. / 发现已保存的准备草稿。It will not be restored
        automatically.
      </p>
      <p v-else>
        The saved draft is stale or damaged and cannot be restored. / 草稿已过期或损坏，无法恢复。
      </p>
      <div class="preparation-actions">
        <button
          v-if="preparation.recovery.status === 'available'"
          :disabled="busy"
          @click="$emit('restore-draft')"
        >
          Restore draft / 恢复草稿
        </button>
        <button class="secondary" :disabled="busy" @click="$emit('discard-recovery')">
          Discard draft / 丢弃草稿
        </button>
      </div>
    </div>

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
      <p v-if="preparation.draftPersisted" role="status">
        {{
          preparation.draftDurabilityUncertain
            ? 'Draft saved, but storage durability is uncertain. / 草稿已保存，但持久化状态不确定。'
            : 'Draft saved privately. / 草稿已私密保存。'
        }}
      </p>
      <ol aria-label="Prepared chapters / 已准备章节">
        <li v-for="(chapter, index) in visibleChapters" :key="chapter.chapterId">
          <label :for="`preparation-title-${chapter.chapterId}`" class="sr-only">
            Chapter title / 章节标题
          </label>
          <input
            :id="`preparation-title-${chapter.chapterId}`"
            :disabled="busy || Boolean(preparation.recovery)"
            :value="chapter.title"
            maxlength="512"
            @input="renameChapter(chapter.chapterId, $event)"
          >
          <button
            type="button"
            :disabled="busy || index === 0 || Boolean(preparation.recovery)"
            :aria-label="`Move ${chapter.title} up / 上移`"
            @click="$emit('edit-draft', { type: 'move-up', chapterId: chapter.chapterId })"
          >
            ↑
          </button>
          <button
            type="button"
            :disabled="
              busy || index === preparation.chapters.length - 1 || Boolean(preparation.recovery)
            "
            :aria-label="`Move ${chapter.title} down / 下移`"
            @click="$emit('edit-draft', { type: 'move-down', chapterId: chapter.chapterId })"
          >
            ↓
          </button>
          <button
            type="button"
            :disabled="busy || preparation.chapters.length <= 1 || Boolean(preparation.recovery)"
            :aria-label="`Remove ${chapter.title} / 移除`"
            @click="$emit('edit-draft', { type: 'remove', chapterId: chapter.chapterId })"
          >
            Remove / 移除
          </button>
        </li>
      </ol>
      <p v-if="omittedChapterCount">
        Showing the first {{ visibleChapters.length }} chapters. {{ omittedChapterCount }} more
        chapters are ready and will be included.
      </p>
      <div v-if="preparation.removedChapters.length">
        <h3>Removed chapters / 已移除章节</h3>
        <ul aria-label="Removed chapters / 已移除章节">
          <li v-for="chapter in preparation.removedChapters" :key="chapter.chapterId">
            {{ chapter.title }}
            <button
              type="button"
              :disabled="busy || Boolean(preparation.recovery)"
              @click="$emit('edit-draft', { type: 'restore', chapterId: chapter.chapterId })"
            >
              Add back / 重新加入
            </button>
          </li>
        </ul>
      </div>
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
      <button class="secondary" aria-label="Cancel" :disabled="busy" @click="$emit('cancel')">
        Close and keep draft / 关闭并保留草稿
      </button>
      <button
        v-if="preparation.draftPersisted"
        class="secondary"
        :disabled="busy"
        @click="$emit('discard-current-draft')"
      >
        Discard saved draft / 丢弃已保存草稿
      </button>
      <button
        :disabled="
          busy ||
            !preparation.revision ||
            !preparation.chapters.length ||
            Boolean(preparation.recovery)
        "
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
import type { BookPreparationDraftOperationDto } from '@shared/types/bookReader'

const props = defineProps<{
  preparation: BookPreparationDto
  error: BookReaderError | null
  busy: boolean
}>()

const emit = defineEmits<{
  select: [sourceNodeId: string]
  create: []
  cancel: []
  'edit-draft': [operation: BookPreparationDraftOperationDto]
  'restore-draft': []
  'discard-recovery': []
  'discard-current-draft': []
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

const renameChapter = (chapterId: string, event: Event): void => {
  emit('edit-draft', {
    type: 'rename',
    chapterId,
    title: (event.target as HTMLInputElement).value
  })
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

.preparation-panel li input {
  max-width: min(42rem, 65vw);
}

.recovery-notice {
  padding: 12px;
  border: 1px solid var(--themeColor);
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
