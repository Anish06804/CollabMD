import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'

/**
 * Observes a Y.Text and exposes its content as a string, plus a revision
 * counter that increments on every change (for save-state indicators).
 */
export function useDocument(ytext: Y.Text | null): { content: string; revision: number } {
  const [content, setContent] = useState('')
  const [revision, setRevision] = useState(0)
  const revisionRef = useRef(0)

  useEffect(() => {
    if (!ytext) return
    const observer = () => {
      setContent(ytext.toString())
      revisionRef.current += 1
      setRevision(revisionRef.current)
    }
    observer()
    ytext.observe(observer)
    return () => ytext.unobserve(observer)
  }, [ytext])

  return { content, revision }
}
