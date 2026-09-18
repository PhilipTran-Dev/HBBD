/**
 * Safe DOM measurement helpers.
 *
 * Guard every `getBoundingClientRect()` access so a synthetic event, an
 * unverified node, or an unreferenced React ref can never reach the DOM API
 * and blow up with `...getBoundingClientRect is not a function`. Framer Motion
 * performs its own internal measurements against drag-constraint refs, so we
 * never hand it a raw ref object that could be detached.
 */

export function getBoundingClientRectSafe(node) {
  const element =
    node && typeof node.getBoundingClientRect === 'function' ? node : null
  if (!element) return null
  try {
    return element.getBoundingClientRect()
  } catch {
    return null
  }
}

export function getEventRect(event) {
  if (!event) return null
  const targetElement = event.currentTarget || event.target
  return getBoundingClientRectSafe(targetElement)
}

export function getRefRect(ref) {
  if (!ref || !ref.current) return null
  return getBoundingClientRectSafe(ref.current)
}

/**
 * Build viewport-frame drag constraints that framer-motion interprets as
 * offsets relative to the dragged element's own layout box, so the element
 * stays inside `frame`.
 *
 * @param {DOMRect} frame - the constraint container's rect (viewport coords)
 * @param {{ left: string, top: string, width: number, height: number }} item
 *   - the drag item's CSS `left`/`top` percentages within the frame and its
 *     pixel size. Pure math only — no live element is measured.
 */
export function buildFrameConstraints(frame, item) {
  if (!frame) return null

  const leftPx = (parseFloat(item.left) / 100) * frame.width
  const topPx = (parseFloat(item.top) / 100) * frame.height

  return {
    // framer: min = layoutAxis.min + value  =>  element left edge stops at frame.left
    left: frame.left - 2 * leftPx,
    // framer: max = layoutAxis.max + value - length  =>  right edge stops at frame.right
    right: frame.right - 2 * leftPx - item.width,
    top: frame.top - 2 * topPx,
    bottom: frame.bottom - 2 * topPx - item.height,
  }
}