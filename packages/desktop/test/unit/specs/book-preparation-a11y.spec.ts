/* eslint-disable @stylistic/space-before-function-paren */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '@vue/compiler-dom'
import { parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  BookChapterDto,
  BookPreparationDto,
  BookReaderNodeDto,
  BookSessionDto
} from '@shared/types/bookReader'
import { renderBookMarkdown } from '@/book/renderMarkdown'
import {
  createBookContentAnchorFreeze,
  redirectFrozenBookAnchorFocus
} from '@/components/bookWorkspace/bookContentAnchorFreeze'

const here = dirname(fileURLToPath(import.meta.url))
const workspacePath = resolve(here, '../../../src/renderer/src/components/bookWorkspace/index.vue')
const panelPath = resolve(
  here,
  '../../../src/renderer/src/components/bookWorkspace/BookPreparationPanel.vue'
)
const treeNodePath = resolve(
  here,
  '../../../src/renderer/src/components/bookWorkspace/BookTreeNode.vue'
)

const compileFullTemplate = (filePath: string) => {
  const source = readFileSync(filePath, 'utf8')
  const { descriptor } = parse(source, { filename: filePath })
  if (!descriptor.template) throw new Error(`Missing template in ${filePath}`)
  const { code } = compile(descriptor.template.content, { mode: 'function' })
  // eslint-disable-next-line no-new-func
  return new Function('Vue', code)(Vue)
}

const panelRender = compileFullTemplate(panelPath)
const treeNodeRender = compileFullTemplate(treeNodePath)
const treeNodeComponent = Vue.defineComponent({
  name: 'BookTreeNode',
  props: {
    node: { type: Object, required: true },
    currentNodeId: { type: String as Vue.PropType<string | null>, default: null },
    disabled: { type: Boolean, default: false },
    describedBy: { type: String, default: undefined }
  },
  emits: ['activate'],
  setup(props, { emit }) {
    const expanded = Vue.ref(true)
    const isCurrent = Vue.computed(
      () =>
        (props.node as BookReaderNodeDto).nodeId === props.currentNodeId ||
        (props.node as BookReaderNodeDto).landingNodeId === props.currentNodeId
    )
    const toggleExpanded = (): void => {
      if (props.disabled) return
      expanded.value = !expanded.value
    }
    const activate = (): void => {
      if (props.disabled) return
      emit('activate', props.node)
    }
    return { expanded, isCurrent, toggleExpanded, activate }
  },
  render: treeNodeRender
})
const preparationPanel = Vue.defineComponent({
  props: {
    preparation: { type: Object, required: true },
    error: { type: Object, default: null },
    busy: { type: Boolean, required: true }
  },
  emits: ['select', 'create', 'cancel'],
  setup(props, { emit }) {
    const selectedSource = Vue.ref('')
    const visibleChapters = Vue.computed(() =>
      (props.preparation as { chapters: unknown[] }).chapters.slice(0, 200)
    )
    const omittedChapterCount = Vue.computed(
      () =>
        (props.preparation as { chapters: unknown[] }).chapters.length -
        visibleChapters.value.length
    )
    const selectSource = (event: Event): void => {
      const value = (event.target as HTMLSelectElement).value
      selectedSource.value = value
      if (value) emit('select', value)
    }
    return { selectedSource, visibleChapters, omittedChapterCount, selectSource }
  },
  render: panelRender
})

const candidate = {
  nodeId: 'opaque-node-1',
  title: 'Same title',
  displayLabel: 'Document 1'
}
const prepared = Vue.reactive<BookPreparationDto>({
  preparationId: 'preparation-id-1',
  sessionId: 'session-id-1',
  revision: null,
  sourceNodeId: null,
  sourceTitle: null,
  candidates: [candidate],
  chapters: [],
  summaryPreview: null,
  requiresSelection: true
})

const mountedApps: Array<{ app: Vue.App; host: HTMLElement }> = []

const mountWorkspace = () => {
  const books = Vue.reactive({
    mode: 'reader',
    session: {
      sessionId: 'session-id-1',
      libraryId: 'library-id-1',
      title: 'Book',
      navigationSource: 'inferred',
      readingProgress: 0,
      entryNodeId: null,
      landingNodeId: null,
      resumeNodeId: null,
      nodes: [],
      diagnostics: []
    } as BookSessionDto,
    chapter: null as BookChapterDto | null,
    libraries: [],
    error: null as { message: string; committed?: boolean } | null,
    loading: false,
    refreshing: false,
    arrangementPending: false,
    arrangement: null,
    arrangementError: null,
    preparationPending: false,
    preparation: prepared as typeof prepared | null,
    preparationError: null as { message: string } | null,
    preparationStatus: null as string | null,
    preparationRetryBlocked: false,
    outputPending: false,
    exportPending: false,
    exportCancelRequested: false,
    exportSuccess: null as string | null,
    websitePending: false,
    websiteCancelRequested: false,
    websiteSuccess: null as string | null,
    searchQuery: '',
    searchResults: [],
    searchLoading: false,
    searchProgress: null,
    searchIndexStatus: null,
    searchTotalResults: 0,
    searchTruncated: false,
    searchError: null,
    readingPositionReady: true,
    previousNodeId: null as string | null,
    nextNodeId: null as string | null
  })
  const render = compileFullTemplate(workspacePath)
  const noop = (): void => undefined
  const navCollapsed = Vue.ref(false)
  const outlineCollapsed = Vue.ref(true)
  const rendered = Vue.reactive({
    html: '',
    outline: [] as Array<{ id: string; text: string; level: number }>
  })
  const localNavigationFrozen = Vue.computed(
    () => books.refreshing || books.preparationRetryBlocked
  )
  const localFreezeDescriptionId = Vue.computed(() =>
    books.refreshing
      ? 'book-refresh-in-progress'
      : books.preparationRetryBlocked
        ? 'book-preparation-refresh-required'
        : undefined
  )
  const contentElement = Vue.ref<HTMLElement | null>(null)
  const leaveButton = Vue.ref<HTMLButtonElement | null>(null)
  const refreshButton = Vue.ref<HTMLButtonElement | null>(null)
  const contentAnchorFreeze = createBookContentAnchorFreeze()
  const focusAfterFrozenContentAnchor = (): void => {
    const candidates = books.refreshing
      ? [leaveButton.value, refreshButton.value]
      : [refreshButton.value, leaveButton.value]
    const fallback = candidates.find((candidate) => candidate && !candidate.disabled)
    if (!fallback) {
      contentElement.value?.focus({ preventScroll: true })
      return
    }
    fallback.focus({ preventScroll: true })
  }
  const handleContentFocusin = (event: FocusEvent): void => {
    redirectFrozenBookAnchorFocus(
      contentElement.value,
      event.target,
      localNavigationFrozen.value,
      focusAfterFrozenContentAnchor
    )
  }
  const outlineActivations = { count: 0 }
  const activateOutline = (event: Event): void => {
    event.preventDefault()
    if (!localNavigationFrozen.value) outlineActivations.count += 1
  }
  const toggleContents = (): void => {
    if (localNavigationFrozen.value) return
    navCollapsed.value = !navCollapsed.value
  }
  const toggleOutline = (): void => {
    if (localNavigationFrozen.value) return
    outlineCollapsed.value = !outlineCollapsed.value
  }
  const app = Vue.createApp({
    setup() {
      Vue.watch(
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
      Vue.onBeforeUnmount(contentAnchorFreeze.restoreAll)
      return {
        books,
        navCollapsed,
        outlineCollapsed,
        contentElement,
        leaveButton,
        refreshButton,
        searchOpen: Vue.ref(false),
        rendered,
        localNavigationFrozen,
        localFreezeDescriptionId,
        formatDate: String,
        formatProgress: () => '0%',
        leaveReader: noop,
        toggleSearch: noop,
        openPreparation: noop,
        closePreparation: noop,
        commitPreparation: noop,
        activateSearchResult: noop,
        closeSearch: noop,
        activateNavigationNode: noop,
        handleReaderScroll: noop,
        handleContentPointerdown: noop,
        handleContentClick: noop,
        handleContentKeydown: noop,
        handleContentFocusin,
        navigatePrevious: noop,
        navigateNext: noop,
        activateOutline,
        toggleContents,
        toggleOutline
      }
    },
    render
  })
  app.component('BookPreparationPanel', preparationPanel)
  for (const name of ['BookSearchPanel', 'BookArrangementPanel', 'BookTreeNode']) {
    app.component(name, Vue.defineComponent({ template: '<div />' }))
  }
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  mountedApps.push({ app, host })
  return {
    books,
    host,
    navCollapsed,
    outlineCollapsed,
    rendered,
    outlineActivations,
    contentElement,
    leaveButton,
    refreshButton
  }
}

const mountBookTree = () => {
  const disabled = Vue.ref(true)
  const activations: BookReaderNodeDto[] = []
  const node: BookReaderNodeDto = {
    nodeId: 'root',
    type: 'group',
    title: 'Root',
    children: [
      {
        nodeId: 'nested',
        type: 'group',
        title: 'Nested',
        children: [
          {
            nodeId: 'chapter',
            type: 'chapter',
            title: 'Chapter',
            children: []
          }
        ]
      }
    ]
  }
  const app = Vue.createApp({
    setup: () => () =>
      Vue.h(treeNodeComponent, {
        node,
        currentNodeId: null,
        disabled: disabled.value,
        describedBy: 'book-refresh-in-progress',
        onActivate: (activated: BookReaderNodeDto) => activations.push(activated)
      })
  })
  app.component('BookTreeNode', treeNodeComponent)
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  mountedApps.push({ app, host })
  return { activations, disabled, host }
}

afterEach(() => {
  prepared.chapters = []
  prepared.requiresSelection = true
  for (const mounted of mountedApps.splice(0)) {
    mounted.app.unmount()
    mounted.host.remove()
  }
})

describe('book preparation workspace accessibility', () => {
  const liveOwners = (host: HTMLElement): NodeListOf<Element> =>
    host.querySelectorAll('[role="alert"], [role="status"], [aria-live]')

  it('keeps one live owner through output-success, begin, select, and commit states', async () => {
    const { books, host } = mountWorkspace()
    books.exportSuccess = 'Old export success.'
    books.preparation = null
    await Vue.nextTick()
    expect(liveOwners(host)).toHaveLength(1)

    books.exportSuccess = null
    books.websiteSuccess = 'Old website success.'
    await Vue.nextTick()
    expect(liveOwners(host)).toHaveLength(1)

    books.websiteSuccess = null
    books.preparation = prepared
    await Vue.nextTick()
    expect(liveOwners(host)).toHaveLength(1)

    books.preparationPending = true
    await Vue.nextTick()
    expect(liveOwners(host)).toHaveLength(1)
    expect(liveOwners(host)[0].textContent).toContain('Preparing book')

    books.preparationPending = false
    books.preparation = null
    books.error = { message: 'LeafBook could not complete this request.' }
    await Vue.nextTick()
    expect(liveOwners(host)).toHaveLength(1)
    expect(liveOwners(host)[0].getAttribute('role')).toBe('alert')

    books.error = null
    books.preparationStatus = 'SUMMARY was created. Arrange mode is now available.'
    await Vue.nextTick()
    expect(liveOwners(host)).toHaveLength(1)
    expect(liveOwners(host)[0].getAttribute('role')).toBe('status')

    books.error = { message: 'SUMMARY may have been created.', committed: true }
    books.preparationRetryBlocked = true
    books.preparationStatus =
      'SUMMARY may have been created. Inspect the book folder, then refresh before preparing again.'
    await Vue.nextTick()
    expect(liveOwners(host)).toHaveLength(1)
    expect(liveOwners(host)[0].getAttribute('role')).toBe('status')
  })

  it('announces refresh freeze once and describes every disabled current-book action', async () => {
    const { books, host, navCollapsed, outlineCollapsed, rendered, outlineActivations } =
      mountWorkspace()
    books.preparation = null
    books.chapter = {
      nodeId: 'opaque-node-1',
      title: 'One',
      markdown: '# One',
      fragment: null,
      readingPosition: 0,
      hasReadingPosition: false
    }
    books.loading = true
    books.refreshing = true
    outlineCollapsed.value = false
    rendered.outline = [{ id: 'one', text: 'One', level: 1 }]
    await Vue.nextTick()

    const status = host.querySelector('#book-refresh-in-progress')
    expect(status?.getAttribute('role')).toBe('status')
    expect(status?.textContent).toContain('Current book actions are unavailable')
    expect(host.querySelectorAll('#book-refresh-in-progress')).toHaveLength(1)
    expect(liveOwners(host)).toHaveLength(1)
    for (const label of [
      'Search',
      'Contents',
      'Outline',
      'Prepare Book',
      'Export…',
      'Generate Website…',
      'Edit',
      'Refreshing…'
    ]) {
      const button = [...host.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === label
      )
      expect(button, label).toBeDefined()
      expect(button?.hasAttribute('disabled'), label).toBe(true)
      expect(button?.getAttribute('aria-describedby'), label).toBe('book-refresh-in-progress')
    }
    const leave = [...host.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Bookshelf')
    )
    expect(leave?.hasAttribute('disabled')).toBe(false)
    const outlineAnchor = host.querySelector<HTMLAnchorElement>('#chapter-outline a')
    expect(outlineAnchor?.getAttribute('aria-disabled')).toBe('true')
    expect(outlineAnchor?.getAttribute('aria-describedby')).toBe('book-refresh-in-progress')
    expect(outlineAnchor?.tabIndex).toBe(-1)
    outlineAnchor?.click()
    outlineAnchor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    outlineAnchor?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(outlineActivations.count).toBe(0)
    for (const label of ['Contents', 'Outline']) {
      const disclosure = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) => candidate.textContent?.trim() === label
      )
      disclosure?.click()
      disclosure?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      disclosure?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    }
    expect(navCollapsed.value).toBe(false)
    expect(outlineCollapsed.value).toBe(false)
  })

  it('gives a panel-less begin rejection exactly one visible live workspace owner', async () => {
    const { books, host } = mountWorkspace()
    books.preparation = null
    books.preparationError = { message: 'LeafBook could not complete this request.' }
    books.error = { message: 'LeafBook could not complete this request.' }
    await Vue.nextTick()
    const owners = liveOwners(host)
    expect(owners).toHaveLength(1)
    expect(owners[0].getAttribute('role')).toBe('alert')
    expect(owners[0].textContent).toContain('could not complete this request')
  })

  it('mounts the full workspace and panel templates with one panel announcement source', async () => {
    prepared.requiresSelection = false
    prepared.sourceTitle = 'Same title'
    prepared.chapters = [{ ordinal: 1, line: 1, title: 'First', fragment: 'first' }]
    const { host } = mountWorkspace()
    await Vue.nextTick()
    expect(host.querySelector('.preparation-panel')).not.toBeNull()
    expect(
      host.querySelectorAll('.preparation-panel [role="status"], .preparation-panel [aria-live]')
    ).toHaveLength(1)
    expect(host.querySelector('.preparation-panel [aria-live]')?.textContent).toContain(
      '1 chapters ready'
    )
  })

  it('gives a current panel error or committed uncertainty exactly one live owner', async () => {
    const { books, host } = mountWorkspace()
    books.error = { message: 'Selection failed.' }
    books.preparationError = { message: 'Selection failed.' }
    await Vue.nextTick()
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(host.querySelectorAll('[role="alert"], [role="status"], [aria-live]')).toHaveLength(1)
    expect(host.querySelector('[role="alert"]')?.closest('.preparation-panel')).not.toBeNull()

    books.preparation = null
    books.preparationError = null
    books.error = { message: 'SUMMARY may have been created.', committed: true }
    books.preparationRetryBlocked = true
    books.preparationStatus =
      'SUMMARY may have been created. Inspect the book folder, then refresh before preparing again.'
    await Vue.nextTick()
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0)
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1)
    const guidance = host.querySelector('#book-preparation-refresh-required')
    expect(guidance?.getAttribute('role')).toBe('status')

    books.preparationStatus = null
    await Vue.nextTick()
    const persistent = host.querySelector('#book-preparation-refresh-required')
    expect(persistent).not.toBeNull()
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0)
    expect(persistent?.hasAttribute('role')).toBe(false)
    expect(persistent?.hasAttribute('aria-live')).toBe(false)
  })

  it('freezes reader actions with one shared visible refresh description', async () => {
    const { books, host, outlineCollapsed, rendered, outlineActivations } = mountWorkspace()
    books.preparation = null
    books.chapter = {
      nodeId: 'chapter-1',
      title: 'Chapter',
      markdown: '# Chapter',
      fragment: null,
      readingPosition: 0,
      hasReadingPosition: false
    }
    books.previousNodeId = 'chapter-0'
    books.nextNodeId = 'chapter-2'
    books.session.landingNodeId = 'chapter-home'
    books.error = { message: 'SUMMARY may have been created.', committed: true }
    books.preparationRetryBlocked = true
    books.preparationStatus =
      'SUMMARY may have been created. Inspect the book folder, then refresh before preparing again.'
    outlineCollapsed.value = false
    rendered.outline = [{ id: 'chapter', text: 'Chapter', level: 1 }]
    await Vue.nextTick()

    const describedId = 'book-preparation-refresh-required'
    const button = (label: string): HTMLButtonElement | undefined =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) => candidate.textContent?.trim() === label
      )
    for (const label of [
      'Search',
      'Contents',
      'Outline',
      'Prepare Book',
      'Export…',
      'Generate Website…',
      'Edit',
      'Book home',
      '← Previous',
      'Next →'
    ]) {
      expect(button(label)?.disabled, label).toBe(true)
      expect(button(label)?.getAttribute('aria-describedby'), label).toBe(describedId)
    }
    expect(button('Refresh')?.disabled).toBe(false)
    expect(button('← Bookshelf')?.disabled).toBe(false)
    const outlineAnchor = host.querySelector<HTMLAnchorElement>('#chapter-outline a')
    expect(outlineAnchor?.getAttribute('aria-disabled')).toBe('true')
    expect(outlineAnchor?.getAttribute('aria-describedby')).toBe(describedId)
    expect(outlineAnchor?.tabIndex).toBe(-1)
    outlineAnchor?.click()
    outlineAnchor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    outlineAnchor?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(outlineActivations.count).toBe(0)
    expect(host.querySelectorAll(`#${describedId}`)).toHaveLength(1)
    expect(liveOwners(host)).toHaveLength(1)

    books.session.navigationSource = 'summary'
    await Vue.nextTick()
    expect(button('Arrange')?.disabled).toBe(true)
    expect(button('Arrange')?.getAttribute('aria-describedby')).toBe(describedId)
    expect(host.querySelectorAll(`#${describedId}`)).toHaveLength(1)
    expect(liveOwners(host)).toHaveLength(1)
  })

  it('resolves real template refs and evicts frozen body-link focus to an enabled control', async () => {
    const { books, host, rendered, contentElement, leaveButton, refreshButton } = mountWorkspace()
    books.preparation = null
    books.chapter = {
      nodeId: 'chapter-1',
      title: 'Chapter',
      markdown: '[External](https://example.com) [Fragment](#part)',
      fragment: null,
      readingPosition: 0,
      hasReadingPosition: false
    }
    rendered.html = (
      await renderBookMarkdown('[External](https://example.com) [Fragment](#part)')
    ).html
    books.preparationRetryBlocked = true
    books.preparationStatus =
      'SUMMARY may have been created. Inspect the book folder, then refresh before preparing again.'
    await Vue.nextTick()

    const button = (label: string): HTMLButtonElement | undefined =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) => candidate.textContent?.trim() === label
      )
    const refresh = button('Refresh')
    const exportButton = button('Export…')
    const bookshelf = button('← Bookshelf')
    const [external, fragment] = Array.from(
      host.querySelectorAll<HTMLAnchorElement>('.leafbook-markdown a[data-book-href]')
    )
    expect(contentElement.value).toBe(host.querySelector('.book-content'))
    expect(refreshButton.value).toBe(refresh)
    expect(refreshButton.value).not.toBe(exportButton)
    expect(refresh?.disabled).toBe(false)
    expect(exportButton?.disabled).toBe(true)
    expect(external.getAttribute('aria-describedby')).toBe('book-preparation-refresh-required')
    external.focus()
    expect(document.activeElement).toBe(refresh)
    expect(document.activeElement).not.toBe(exportButton)
    expect(document.activeElement).not.toBe(document.body)

    books.preparationRetryBlocked = false
    books.preparationStatus = null
    books.refreshing = true
    await Vue.nextTick()
    expect(refreshButton.value?.disabled).toBe(true)
    expect(leaveButton.value).toBe(bookshelf)
    expect(leaveButton.value?.disabled).toBe(false)
    expect(fragment.getAttribute('aria-describedby')).toBe('book-refresh-in-progress')
    fragment.focus()
    expect(document.activeElement).toBe(bookshelf)
    expect(document.activeElement).not.toBe(exportButton)
    expect(document.activeElement).not.toBe(document.body)
  })

  it('keeps keyboard navigation behind the committed-uncertain freeze', () => {
    const source = readFileSync(workspacePath, 'utf8')
    const { descriptor } = parse(source, { filename: workspacePath })
    const script = descriptor.scriptSetup?.content ?? ''
    expect(script).toContain('!books.preparationRetryBlocked &&')
    expect(script).toContain("event.key === 'ArrowLeft'")
    expect(script).toContain("event.key === 'ArrowRight'")
    expect(script).toContain(
      'if (books.refreshing || books.outputPending || books.preparationRetryBlocked) return'
    )
    expect(script).toContain(
      "if (event.key === 'Escape' && !navCollapsed.value && !localNavigationFrozen.value)"
    )
    expect(script).toContain(
      'if (localNavigationFrozen.value && !(allowDuringRefresh && books.refreshing)) return'
    )
    expect(script).toContain("scrollToHeading(heading.id, 'auto', true)")
    expect(descriptor.template?.content).toContain('@pointerdown="handleContentPointerdown"')
    expect(descriptor.template?.content).toContain('@focusin="handleContentFocusin"')
    expect(script).toContain('() => rendered.html')
    expect(script).toContain('contentAnchorFreeze.sync(')
    expect(script).toContain('blockFrozenBookAnchorInteraction(')
    expect(script).toContain('redirectFrozenBookAnchorFocus(')
    expect(script).toContain('contentAnchorFreeze.restoreAll()')
  })

  it('freezes click and keyboard behavior for every recursive tree control', async () => {
    const { activations, disabled, host } = mountBookTree()
    const controls = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    expect(controls.length).toBeGreaterThanOrEqual(5)
    for (const control of controls) {
      expect(control.disabled, control.textContent ?? control.className).toBe(true)
      expect(control.getAttribute('aria-describedby')).toBe('book-refresh-in-progress')
      control.click()
      control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      control.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    }
    expect(host.querySelectorAll('.book-tree-node')).toHaveLength(3)
    expect(
      Array.from(host.querySelectorAll('[aria-expanded]')).every(
        (control) => control.getAttribute('aria-expanded') === 'true'
      )
    ).toBe(true)
    expect(activations).toHaveLength(0)
    const treeSource = readFileSync(treeNodePath, 'utf8')
    expect(treeSource.match(/if \(props\.disabled\) return/g)).toHaveLength(2)
    expect(treeSource).not.toContain('@click="expanded = !expanded"')

    disabled.value = false
    await Vue.nextTick()
    const chapter = Array.from(host.querySelectorAll<HTMLButtonElement>('.tree-label')).find(
      (control) => control.textContent?.trim() === 'Chapter'
    )
    chapter?.click()
    expect(activations.map((node) => node.nodeId)).toEqual(['chapter'])
    const nestedToggle = Array.from(host.querySelectorAll<HTMLButtonElement>('.tree-toggle')).find(
      (control) => control.getAttribute('aria-label') === 'Collapse Nested'
    )
    nestedToggle?.click()
    await Vue.nextTick()
    expect(host.querySelectorAll('.book-tree-node')).toHaveLength(2)
  })
})
