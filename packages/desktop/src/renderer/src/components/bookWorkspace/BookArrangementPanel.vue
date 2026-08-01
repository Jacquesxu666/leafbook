<!-- eslint-disable vue/max-attributes-per-line, vue/singleline-html-element-content-newline -->
<template>
  <section class="arrangement-panel" aria-labelledby="arrangement-title">
    <header class="arrangement-header">
      <div>
        <p class="panel-label">Contents draft</p>
        <h2 id="arrangement-title">Arrange book</h2>
      </div>
      <span class="draft-state" :class="{ dirty: arrangement.dirty }">
        {{ arrangement.dirty ? 'Unsaved changes' : 'No changes' }}
      </span>
    </header>
    <p class="arrangement-help">
      Drag chapters, use the arrow buttons, or press Alt with an arrow key. Headings stay fixed.
    </p>
    <p v-if="error" class="arrangement-error" role="alert">{{ error.message }}</p>
    <div class="arrangement-preview" aria-label="Arrangement preview">
      <span>{{ nodeCount }} items</span>
      <span>{{ arrangement.preview.operationCount }} operations</span>
      <span>{{ formatBytes(arrangement.preview.byteLength) }}</span>
    </div>
    <ul
      ref="treeElement"
      class="arrangement-tree"
      role="tree"
      aria-label="Book contents arrangement"
      :aria-busy="busy"
    >
      <book-arrangement-node
        v-for="node in arrangement.nodes"
        :key="node.nodeId"
        :node="node"
        :focused-node-id="focusedNodeId"
        :dragged-node-id="draggedNodeId"
        :drop-target-node-id="dropTargetNodeId"
        :busy="busy"
        :can-move-up="canMoveUp"
        :can-move-down="canMoveDown"
        :can-drop="canDrop"
        @focus-node="focusedNodeId = $event"
        @node-keydown="handleNodeKeydown"
        @command="runCommand"
        @drag-start="handleDragStart"
        @drag-end="clearDrag"
        @drag-over="dropTargetNodeId = $event"
        @drag-leave="handleDragLeave"
        @drop-node="handleDrop"
      />
    </ul>
    <p class="sr-only" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
    <footer class="arrangement-actions">
      <button class="secondary" :disabled="busy || !arrangement.canUndo" @click="handleUndo">
        Undo
      </button>
      <span class="arrangement-actions-spacer" />
      <button class="secondary" :disabled="busy" @click="$emit('cancel')">Cancel</button>
      <button :disabled="busy || !arrangement.dirty" @click="$emit('save')">
        {{ busy ? 'Working…' : 'Save contents' }}
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type {
  BookArrangementDto,
  BookArrangementNodeDto,
  BookArrangementOperationDto,
  BookReaderError
} from '@shared/types/bookReader'
import BookArrangementNode from './BookArrangementNode.vue'

type ArrangementCommand = 'up' | 'down' | 'indent' | 'outdent'
type DropPlacement = 'before' | 'after'

const props = defineProps<{
  arrangement: BookArrangementDto
  error: BookReaderError | null
  busy: boolean
  applyOperation: (operation: BookArrangementOperationDto) => Promise<boolean>
  undoOperation: () => Promise<boolean>
}>()
defineEmits<{
  save: []
  cancel: []
}>()
const treeElement = ref<HTMLElement | null>(null)
const focusedNodeId = ref<string | null>(null)
const draggedNodeId = ref<string | null>(null)
const dropTargetNodeId = ref<string | null>(null)
const announcement = ref('')

interface FlatNode {
  node: BookArrangementNodeDto
  siblings: BookArrangementNodeDto[]
}
const flatten = (nodes: BookArrangementNodeDto[], result: FlatNode[] = []): FlatNode[] => {
  for (const node of nodes) {
    result.push({ node, siblings: nodes })
    flatten(node.children, result)
  }
  return result
}
const flatNodes = computed(() => flatten(props.arrangement.nodes))
const nodeCount = computed(() => flatNodes.value.length)
const entry = (nodeId: string): FlatNode | undefined =>
  flatNodes.value.find((candidate) => candidate.node.nodeId === nodeId)
const siblingIndex = (
  nodeId: string
): { siblings: BookArrangementNodeDto[]; index: number } | null => {
  const current = entry(nodeId)
  if (!current) return null
  return {
    siblings: current.siblings,
    index: current.siblings.findIndex((node) => node.nodeId === nodeId)
  }
}
const listSibling = (
  nodes: BookArrangementNodeDto[],
  index: number
): BookArrangementNodeDto | null => {
  const candidate = nodes[index]
  return candidate?.kind === 'list' ? candidate : null
}
const canMoveUp = (nodeId: string): boolean => {
  const current = siblingIndex(nodeId)
  const node = entry(nodeId)?.node
  return Boolean(
    current &&
    node?.kind === 'list' &&
    node.canIndent &&
    listSibling(current.siblings, current.index - 1)
  )
}
const canMoveDown = (nodeId: string): boolean => {
  const current = siblingIndex(nodeId)
  const target = current ? listSibling(current.siblings, current.index + 1) : null
  return Boolean(current && entry(nodeId)?.node.kind === 'list' && target && target.canIndent)
}
const safeSection = (siblings: BookArrangementNodeDto[], nodeId: string): number => {
  let section = 0
  for (let index = 0; index < siblings.length; index += 1) {
    const node = siblings[index]
    if (index > 0 && (node?.kind === 'heading' || (node?.kind === 'list' && !node.canIndent))) {
      section += 1
    }
    if (node?.nodeId === nodeId) return section
  }
  return -1
}
const canDrop = (sourceId: string, targetId: string): boolean => {
  const source = siblingIndex(sourceId)
  const target = siblingIndex(targetId)
  return Boolean(
    source &&
    target &&
    source.siblings === target.siblings &&
    safeSection(source.siblings, sourceId) === safeSection(target.siblings, targetId) &&
    sourceId !== targetId &&
    entry(sourceId)?.node.kind === 'list' &&
    entry(targetId)?.node.kind === 'list'
  )
}
const focusNode = async (nodeId: string): Promise<void> => {
  focusedNodeId.value = nodeId
  await nextTick()
  treeElement.value
    ?.querySelector<HTMLElement>(`[data-arrangement-node-id="${CSS.escape(nodeId)}"]`)
    ?.focus()
}
const announce = (message: string): void => {
  announcement.value = ''
  nextTick(() => {
    announcement.value = message
  })
}
const operationAnnouncement = async (
  operation: () => Promise<boolean>,
  successMessage: string
): Promise<void> => {
  const candidateRevision = props.arrangement.candidateRevision
  const operationCount = props.arrangement.preview.operationCount
  const succeeded = await operation()
  await nextTick()
  const changed =
    props.arrangement.candidateRevision !== candidateRevision ||
    props.arrangement.preview.operationCount !== operationCount
  announce(
    succeeded && changed
      ? successMessage
      : (props.error?.message ?? 'The arrangement operation could not be completed.')
  )
}
const runCommand = async (command: ArrangementCommand, nodeId: string): Promise<void> => {
  const current = siblingIndex(nodeId)
  const node = entry(nodeId)?.node
  if (!current || !node || node.kind !== 'list' || props.busy) return
  let operation: BookArrangementOperationDto | null = null
  if (command === 'up' && canMoveUp(nodeId)) {
    const target = listSibling(current.siblings, current.index - 1)
    if (target) operation = { type: 'move-before', nodeId, targetNodeId: target.nodeId }
  } else if (command === 'down' && canMoveDown(nodeId)) {
    const target = listSibling(current.siblings, current.index + 1)
    if (target) operation = { type: 'move-after', nodeId, targetNodeId: target.nodeId }
  } else if (command === 'indent' && node.canIndent) {
    operation = { type: 'indent', nodeId }
  } else if (command === 'outdent' && node.canOutdent) {
    operation = { type: 'outdent', nodeId }
  }
  if (!operation) return
  focusedNodeId.value = nodeId
  await operationAnnouncement(
    () => props.applyOperation(operation),
    `${node.title}: ${command} completed.`
  )
}
const handleNodeKeydown = (event: KeyboardEvent, nodeId: string): void => {
  const index = flatNodes.value.findIndex((candidate) => candidate.node.nodeId === nodeId)
  if (event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault()
    const commands: Record<string, ArrangementCommand> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'outdent',
      ArrowRight: 'indent'
    }
    runCommand(commands[event.key]!, nodeId).catch(() => undefined)
    return
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  let target: BookArrangementNodeDto | undefined
  if (event.key === 'ArrowUp') target = flatNodes.value[index - 1]?.node
  else if (event.key === 'ArrowDown') target = flatNodes.value[index + 1]?.node
  else if (event.key === 'Home') target = flatNodes.value[0]?.node
  else if (event.key === 'End') target = flatNodes.value.at(-1)?.node
  if (target) {
    event.preventDefault()
    focusNode(target.nodeId)
  }
}
const handleDragStart = (nodeId: string): void => {
  draggedNodeId.value = nodeId
  focusedNodeId.value = nodeId
  announce(`${entry(nodeId)?.node.title ?? 'Item'} grabbed.`)
}
const clearDrag = (): void => {
  draggedNodeId.value = null
  dropTargetNodeId.value = null
}
const handleDragLeave = (nodeId: string): void => {
  if (dropTargetNodeId.value === nodeId) dropTargetNodeId.value = null
}
const handleDrop = async (targetId: string, placement: DropPlacement): Promise<void> => {
  const sourceId = draggedNodeId.value
  if (!sourceId || !canDrop(sourceId, targetId)) {
    clearDrag()
    return
  }
  const title = entry(sourceId)?.node.title ?? 'Item'
  const operation: BookArrangementOperationDto = {
    type: placement === 'before' ? 'move-before' : 'move-after',
    nodeId: sourceId,
    targetNodeId: targetId
  }
  const targetTitle = entry(targetId)?.node.title ?? 'target'
  clearDrag()
  await operationAnnouncement(
    () => props.applyOperation(operation),
    `${title} moved ${placement} ${targetTitle}.`
  )
}
const handleUndo = async (): Promise<void> => {
  await operationAnnouncement(props.undoOperation, 'Last arrangement undone.')
  if (focusedNodeId.value) focusNode(focusedNodeId.value).catch(() => undefined)
}
const formatBytes = (value: number): string =>
  value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`

watch(
  () => props.arrangement.nodes,
  async () => {
    const ids = new Set(flatNodes.value.map((candidate) => candidate.node.nodeId))
    if (!focusedNodeId.value || !ids.has(focusedNodeId.value)) {
      focusedNodeId.value = flatNodes.value[0]?.node.nodeId ?? null
    }
    if (focusedNodeId.value && document.activeElement?.closest('.arrangement-tree')) {
      await focusNode(focusedNodeId.value)
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.arrangement-panel {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}
.arrangement-header,
.arrangement-preview,
.arrangement-actions {
  display: flex;
  align-items: center;
}
.arrangement-header {
  justify-content: space-between;
  gap: 10px;
}
.arrangement-header h2 {
  margin: 2px 0 0;
  font-size: 18px;
}
.draft-state {
  font-size: 11px;
  opacity: 0.65;
}
.draft-state.dirty {
  color: var(--themeColor);
  font-weight: 700;
  opacity: 1;
}
.arrangement-help,
.arrangement-error {
  margin: 10px 0;
  font-size: 12px;
  line-height: 1.45;
}
.arrangement-error {
  color: #d05656;
}
.arrangement-preview {
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 8px;
  border-radius: 7px;
  background: var(--itemBgColor);
  font-size: 11px;
}
.arrangement-tree {
  min-height: 0;
  flex: 1;
  overflow: auto;
  margin: 10px 0;
  padding: 0 2px;
}
.arrangement-actions {
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--floatBorderColor);
}
.arrangement-actions-spacer {
  flex: 1;
}
.arrangement-actions button {
  padding: 7px 10px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
</style>
