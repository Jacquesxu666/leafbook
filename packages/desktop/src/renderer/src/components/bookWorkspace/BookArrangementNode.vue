<!-- eslint-disable vue/max-attributes-per-line -->
<template>
  <li
    class="arrangement-node"
    :class="{
      heading: node.kind === 'heading',
      dragging: draggedNodeId === node.nodeId,
      'drop-target': dropTargetNodeId === node.nodeId
    }"
    role="treeitem"
    :tabindex="focusedNodeId === node.nodeId ? 0 : -1"
    :data-arrangement-node-id="node.nodeId"
    :aria-level="node.depth + 1"
    :aria-selected="focusedNodeId === node.nodeId"
    :aria-expanded="node.children.length ? true : undefined"
    :aria-label="
      node.kind === 'heading' ? `${node.title}, fixed heading` : `${node.title}, chapter entry`
    "
    :aria-grabbed="node.kind === 'list' ? draggedNodeId === node.nodeId : undefined"
    :draggable="node.kind === 'list' && !busy"
    @focus="$emit('focus-node', node.nodeId)"
    @keydown.self="handleNodeKeydown"
    @dragstart.stop="handleDragStart"
    @dragend.stop="$emit('drag-end')"
    @dragover.stop="handleDragOver"
    @dragleave.stop="$emit('drag-leave', node.nodeId)"
    @drop.stop="handleDrop"
  >
    <div ref="rowElement" class="arrangement-row">
      <div class="arrangement-label" :class="{ fixed: node.kind === 'heading' }" aria-hidden="true">
        <span class="drag-handle" aria-hidden="true">{{ node.kind === 'list' ? '⠿' : '§' }}</span>
        <span class="arrangement-title">{{ node.title }}</span>
        <span v-if="node.kind === 'heading'" class="fixed-label">Fixed</span>
      </div>
      <div v-if="node.kind === 'list'" class="arrangement-node-actions">
        <button
          :aria-label="`Move ${node.title} up`"
          tabindex="-1"
          :disabled="busy || !canMoveUp(node.nodeId)"
          @click="$emit('command', 'up', node.nodeId)"
        >
          ↑
        </button>
        <button
          :aria-label="`Move ${node.title} down`"
          tabindex="-1"
          :disabled="busy || !canMoveDown(node.nodeId)"
          @click="$emit('command', 'down', node.nodeId)"
        >
          ↓
        </button>
        <button
          :aria-label="`Outdent ${node.title}`"
          tabindex="-1"
          :disabled="busy || !node.canOutdent"
          @click="$emit('command', 'outdent', node.nodeId)"
        >
          ←
        </button>
        <button
          :aria-label="`Indent ${node.title}`"
          tabindex="-1"
          :disabled="busy || !node.canIndent"
          @click="$emit('command', 'indent', node.nodeId)"
        >
          →
        </button>
      </div>
    </div>
    <ul v-if="node.children.length" role="group" class="arrangement-children">
      <book-arrangement-node
        v-for="child in node.children"
        :key="child.nodeId"
        :node="child"
        :focused-node-id="focusedNodeId"
        :dragged-node-id="draggedNodeId"
        :drop-target-node-id="dropTargetNodeId"
        :busy="busy"
        :can-move-up="canMoveUp"
        :can-move-down="canMoveDown"
        :can-drop="canDrop"
        @focus-node="$emit('focus-node', $event)"
        @node-keydown="(event, nodeId) => $emit('node-keydown', event, nodeId)"
        @command="(command, nodeId) => $emit('command', command, nodeId)"
        @drag-start="$emit('drag-start', $event)"
        @drag-end="$emit('drag-end')"
        @drag-over="$emit('drag-over', $event)"
        @drag-leave="$emit('drag-leave', $event)"
        @drop-node="(targetId, placement) => $emit('drop-node', targetId, placement)"
      />
    </ul>
  </li>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { BookArrangementNodeDto } from '@shared/types/bookReader'

type ArrangementCommand = 'up' | 'down' | 'indent' | 'outdent'
type DropPlacement = 'before' | 'after'

const props = defineProps<{
  node: BookArrangementNodeDto
  focusedNodeId: string | null
  draggedNodeId: string | null
  dropTargetNodeId: string | null
  busy: boolean
  canMoveUp: (nodeId: string) => boolean
  canMoveDown: (nodeId: string) => boolean
  canDrop: (sourceId: string, targetId: string) => boolean
}>()
const emit = defineEmits<{
  'focus-node': [nodeId: string]
  'node-keydown': [event: KeyboardEvent, nodeId: string]
  command: [command: ArrangementCommand, nodeId: string]
  'drag-start': [nodeId: string]
  'drag-end': []
  'drag-over': [nodeId: string]
  'drag-leave': [nodeId: string]
  'drop-node': [targetId: string, placement: DropPlacement]
}>()
const rowElement = ref<HTMLElement | null>(null)

const handleNodeKeydown = (event: KeyboardEvent): void => {
  if (event.currentTarget !== event.target || props.focusedNodeId !== props.node.nodeId) return
  emit('node-keydown', event, props.node.nodeId)
}

const handleDragStart = (event: DragEvent): void => {
  if (props.node.kind !== 'list' || props.busy || !event.dataTransfer) {
    event.preventDefault()
    return
  }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', props.node.nodeId)
  emit('drag-start', props.node.nodeId)
}

const handleDragOver = (event: DragEvent): void => {
  const sourceId = props.draggedNodeId
  if (
    !sourceId ||
    props.node.kind !== 'list' ||
    props.busy ||
    !props.canDrop(sourceId, props.node.nodeId)
  ) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  emit('drag-over', props.node.nodeId)
}

const handleDrop = (event: DragEvent): void => {
  const sourceId = props.draggedNodeId
  if (
    !sourceId ||
    props.node.kind !== 'list' ||
    props.busy ||
    !props.canDrop(sourceId, props.node.nodeId)
  ) {
    return
  }
  event.preventDefault()
  const bounds = rowElement.value?.getBoundingClientRect()
  if (!bounds) return
  emit(
    'drop-node',
    props.node.nodeId,
    event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
  )
}
</script>

<style scoped>
.arrangement-node {
  margin: 3px 0;
  list-style: none;
  border-radius: 7px;
  outline: none;
}
.arrangement-node:focus-visible > .arrangement-row > .arrangement-label {
  border-color: var(--themeColor);
  outline: 2px solid var(--themeColor);
  outline-offset: 1px;
}
.arrangement-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
}
.arrangement-label {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 7px 8px;
  color: var(--editorColor);
  background: transparent;
  text-align: left;
}
.arrangement-label.fixed {
  cursor: default;
  font-weight: 700;
}
.drag-handle {
  flex: none;
  opacity: 0.55;
}
.arrangement-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fixed-label {
  margin-left: auto;
  font-size: 10px;
  opacity: 0.55;
  text-transform: uppercase;
}
.arrangement-node-actions {
  display: flex;
  flex: none;
  gap: 2px;
}
.arrangement-node-actions button {
  min-width: 27px;
  padding: 5px;
  border-radius: 5px;
}
.arrangement-children {
  margin: 0 0 0 18px;
  padding: 0;
}
.dragging {
  opacity: 0.5;
}
.drop-target > .arrangement-row > .arrangement-label {
  border-color: var(--themeColor);
  background: var(--itemBgColor);
}
@media (max-width: 700px) {
  .arrangement-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .arrangement-node-actions {
    align-self: stretch;
    justify-content: flex-end;
  }
}
</style>
