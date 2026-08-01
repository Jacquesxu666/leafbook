<template>
  <!-- prettier-ignore -->
  <div
    v-if="decision.open"
    class="book-edit-dialog-backdrop"
    @keydown.capture="handleKeydown"
  >
    <section
      ref="dialogElement"
      class="book-edit-dialog"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="book-edit-dialog-title"
      aria-describedby="book-edit-dialog-message"
    >
      <h2 id="book-edit-dialog-title">
        {{ decision.title }}
      </h2>
      <p id="book-edit-dialog-message">
        {{ decision.message }}
      </p>
      <div class="book-edit-dialog-actions">
        <button
          v-for="action in decision.actions"
          :key="action.id"
          :ref="action.id === decision.cancelId ? setCancelButton : undefined"
          :class="{ primary: action.primary, danger: action.danger }"
          @click="resolveBookEditDecision(decision.requestId, action.id)"
        >
          {{ action.label }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  bookEditDecision as decision,
  disposeAllBookEditDecisions,
  resolveBookEditDecision
} from '@/services/bookEditDecision'

let cancelButton: HTMLButtonElement | null = null
const dialogElement = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
const setCancelButton = (element: unknown): void => {
  cancelButton = element instanceof HTMLButtonElement ? element : null
}
const cancel = (): void => resolveBookEditDecision(decision.requestId, decision.cancelId)
const handleKeydown = (event: KeyboardEvent): void => {
  if (!decision.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel()
    return
  }
  if (event.key !== 'Tab') return
  const buttons = [...(dialogElement.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  if (!buttons.length) {
    event.preventDefault()
    dialogElement.value?.focus()
    return
  }
  const first = buttons[0]!
  const last = buttons[buttons.length - 1]!
  if (!dialogElement.value?.contains(document.activeElement)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
    return
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === dialogElement.value)
  ) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
watch([() => decision.open, () => decision.requestId], async ([open], [wasOpen]) => {
  if (open) {
    if (!wasOpen) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    await nextTick()
    ;(cancelButton ?? dialogElement.value)?.focus()
  } else {
    await nextTick()
    previousFocus?.focus()
    previousFocus = null
  }
})
onMounted(() => document.addEventListener('keydown', handleKeydown, true))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown, true)
  disposeAllBookEditDecisions()
  previousFocus?.focus()
  previousFocus = null
})
</script>

<style scoped>
.book-edit-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 45%);
}
.book-edit-dialog {
  width: min(520px, calc(100vw - 40px));
  padding: 24px;
  border-radius: 12px;
  color: var(--editorColor);
  background: var(--editorBgColor);
  box-shadow: 0 18px 60px rgb(0 0 0 / 35%);
}
.book-edit-dialog h2 {
  margin: 0 0 12px;
}
.book-edit-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
.book-edit-dialog button {
  border: 1px solid var(--editorColor10);
  border-radius: 7px;
  padding: 8px 14px;
  color: var(--editorColor);
  background: var(--sideBarBgColor);
}
.book-edit-dialog button:focus-visible {
  outline: 2px solid var(--themeColor);
}
.book-edit-dialog button.primary {
  color: var(--buttonPrimaryFontColor);
  background: var(--buttonPrimaryBgColor);
}
.book-edit-dialog button.danger {
  color: #c84848;
}
</style>
