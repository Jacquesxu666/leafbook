import type { BookReaderNodeDto } from '@shared/types/bookReader'

export const flattenReadableNodeIds = (
  nodes: readonly BookReaderNodeDto[],
  rootLandingNodeId: string | null = null
): string[] => {
  const result: string[] = []
  if (rootLandingNodeId) result.push(rootLandingNodeId)
  const visit = (node: BookReaderNodeDto): void => {
    if (node.type === 'chapter') result.push(node.nodeId)
    if (node.type === 'group' && node.landingNodeId) result.push(node.landingNodeId)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return result
}

export const adjacentChapter = (
  nodes: readonly BookReaderNodeDto[],
  currentNodeId: string | null,
  direction: -1 | 1,
  rootLandingNodeId: string | null = null
): string | null => {
  const ordered = flattenReadableNodeIds(nodes, rootLandingNodeId)
  const index = currentNodeId ? ordered.indexOf(currentNodeId) : -1
  const target = index + direction
  return target >= 0 && target < ordered.length ? (ordered[target] ?? null) : null
}
