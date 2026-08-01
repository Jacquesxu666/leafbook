<!-- eslint-disable vue/max-attributes-per-line, vue/singleline-html-element-content-newline -->
<template>
  <li class="book-tree-node">
    <div class="book-tree-row">
      <button
        v-if="node.children.length"
        class="tree-toggle"
        :aria-label="expanded ? `Collapse ${node.title}` : `Expand ${node.title}`"
        :aria-expanded="expanded"
        :disabled="disabled"
        :aria-describedby="disabled ? describedBy : undefined"
        @click="toggleExpanded"
      >
        {{ expanded ? '▾' : '▸' }}
      </button>
      <span v-else class="tree-spacer" aria-hidden="true" />
      <button
        v-if="node.type !== 'group' || node.landingNodeId"
        class="tree-label"
        :class="{ current: isCurrent }"
        :aria-current="isCurrent ? 'page' : undefined"
        :disabled="disabled"
        :aria-describedby="disabled ? describedBy : undefined"
        @click="activate"
      >
        {{ node.title }}
        <span v-if="node.type === 'external'" aria-hidden="true">↗</span>
      </button>
      <button
        v-else-if="node.children.length"
        class="tree-label tree-group-label"
        :aria-expanded="expanded"
        :disabled="disabled"
        :aria-describedby="disabled ? describedBy : undefined"
        @click="toggleExpanded"
      >
        {{ node.title }}
      </button>
      <span v-else class="tree-label tree-static-label">{{ node.title }}</span>
    </div>
    <ul v-if="node.children.length && expanded" class="book-tree-children">
      <book-tree-node
        v-for="child in node.children"
        :key="child.nodeId"
        :node="child"
        :current-node-id="currentNodeId"
        :disabled="disabled"
        :described-by="describedBy"
        @activate="$emit('activate', $event)"
      />
    </ul>
  </li>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BookReaderNodeDto } from '@shared/types/bookReader'

const props = defineProps<{
  node: BookReaderNodeDto
  currentNodeId: string | null
  disabled?: boolean
  describedBy?: string
}>()
const emit = defineEmits<{ activate: [node: BookReaderNodeDto] }>()
const expanded = ref(true)
const isCurrent = computed(
  () =>
    props.node.nodeId === props.currentNodeId || props.node.landingNodeId === props.currentNodeId
)
const toggleExpanded = (): void => {
  if (props.disabled) return
  expanded.value = !expanded.value
}
const activate = (): void => {
  if (props.disabled) return
  emit('activate', props.node)
}
</script>

<style scoped>
.book-tree-row {
  display: flex;
  align-items: center;
  min-width: 0;
}
.book-tree-row button {
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.book-tree-row button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.tree-toggle,
.tree-spacer {
  width: 26px;
  flex: none;
}
.tree-toggle {
  padding: 5px;
  color: var(--editorColor);
  background: transparent;
}
.tree-spacer {
  display: inline-block;
}
.tree-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  padding: 7px 8px;
  color: var(--editorColor);
  background: transparent;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-label.current {
  color: var(--themeColor);
  background: var(--itemBgColor);
  font-weight: 600;
}
.tree-static-label {
  cursor: default;
}
.tree-toggle:focus-visible,
.tree-label:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: -2px;
}
.book-tree-children {
  margin: 0 0 0 12px;
  padding: 0;
  list-style: none;
}
</style>
