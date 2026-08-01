import { reactive } from 'vue'

export interface BookEditDecisionAction {
  id: string
  label: string
  primary?: boolean
  danger?: boolean
}

export interface BookEditDecisionOwner {
  tabId: string
  operationGeneration: number
  isCurrent: () => boolean
}

interface PendingBookEditDecision {
  requestId: number
  title: string
  message: string
  actions: BookEditDecisionAction[]
  cancelId: string
  owner?: BookEditDecisionOwner
  resolve: (value: string) => void
}

export const bookEditDecision = reactive({
  open: false,
  requestId: 0,
  title: '',
  message: '',
  actions: [] as BookEditDecisionAction[],
  cancelId: 'cancel'
})

let nextRequestId = 0
let active: PendingBookEditDecision | null = null
const queue: PendingBookEditDecision[] = []

const ownerIsCurrent = (request: PendingBookEditDecision): boolean =>
  !request.owner || request.owner.isCurrent()

const showNext = (): void => {
  if (active) return
  while (queue.length) {
    const request = queue.shift()
    if (!request) continue
    if (!ownerIsCurrent(request)) {
      request.resolve(request.cancelId)
      continue
    }
    active = request
    bookEditDecision.requestId = request.requestId
    bookEditDecision.title = request.title
    bookEditDecision.message = request.message
    bookEditDecision.actions = request.actions
    bookEditDecision.cancelId = request.cancelId
    bookEditDecision.open = true
    return
  }
  bookEditDecision.open = false
}

export const requestBookEditDecision = (
  title: string,
  message: string,
  actions: BookEditDecisionAction[],
  cancelId = 'cancel',
  owner?: BookEditDecisionOwner
): Promise<string> =>
  new Promise((resolve) => {
    queue.push({
      requestId: ++nextRequestId,
      title,
      message,
      actions,
      cancelId,
      ...(owner ? { owner } : {}),
      resolve
    })
    showNext()
  })

export const resolveBookEditDecision = (requestId: number, value: string): void => {
  const request = active
  if (!request || request.requestId !== requestId) return
  active = null
  request.resolve(ownerIsCurrent(request) ? value : request.cancelId)
  showNext()
}

export const disposeBookEditDecisions = (tabId: string, operationGeneration?: number): void => {
  const matches = (request: PendingBookEditDecision): boolean =>
    request.owner?.tabId === tabId &&
    (operationGeneration === undefined || request.owner.operationGeneration === operationGeneration)
  if (active && matches(active)) {
    const request = active
    active = null
    request.resolve(request.cancelId)
  }
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const request = queue[index]
    if (!request) continue
    if (matches(request)) {
      queue.splice(index, 1)
      request.resolve(request.cancelId)
    }
  }
  showNext()
}

export const disposeAllBookEditDecisions = (): void => {
  if (active) {
    const request = active
    active = null
    request.resolve(request.cancelId)
  }
  for (const request of queue.splice(0)) request.resolve(request.cancelId)
  bookEditDecision.open = false
}
