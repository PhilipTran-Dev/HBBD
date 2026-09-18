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
 * True on phones and small tablets (width < 768px). Used to gate the
 * heaviest visual work (dozens of infinite loops, backdrop-blur layers)
 * behind a cheap trait, never inside a layout effect.
 */
export function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
}

/**
 * Build numeric drag constraints for framer-motion.
 *
 * Numeric `dragConstraints` are NOT viewport coords — they are the allowed
 * min/max of the element's x/y transform deltas measured FROM its initial
 * rendered CSS position (x=y=0 at rest). So to keep the element's full box
 * inside the safe `frame` region:
 *   min = frameEdge - elementOffset        (top/left edges of the frame)
 *   max = frameEdge - elementOffset - size (right/bottom edges of the frame)
 *
 * @param {DOMRect} frame - the safe region in viewport coords
 * @param {{ left: string, top: string, width: number, height: number }} item
 *   - the drag item's CSS `left`/`top` percentages within the frame and its
 *     pixel size. Pure math only — no live element is measured.
 */
export function buildFrameConstraints(frame, item) {
  if (!frame) return null

  const leftPx = (parseFloat(item.left) / 100) * frame.width
  const topPx = (parseFloat(item.top) / 100) * frame.height

  return {
    left: frame.left - leftPx,
    right: frame.right - leftPx - item.width,
    top: frame.top - topPx,
    bottom: frame.bottom - topPx - item.height,
  }
}