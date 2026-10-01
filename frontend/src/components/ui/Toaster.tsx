import { useEffect, useState } from 'react'
import { CheckCircle, AlertCircle, Info } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

let pushToast: ((kind: ToastKind, message: string) => void) | null = null

export function toast(kind: ToastKind, message: string) {
  pushToast?.(kind, message)
}

export function toastSuccess(message: string) {
  toast('success', message)
}

export function toastError(message: string) {
  toast('error', message)
}

export function toastInfo(message: string) {
  toast('info', message)
}

const icons: Record<ToastKind, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
}

const colors: Record<ToastKind, string> = {
  success: 'border-emerald-500/40 text-emerald-300',
  error: 'border-red-500/40 text-red-300',
  info: 'border-blue-500/40 text-blue-300',
}

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    let nextId = 1
    pushToast = (kind, message) => {
      const id = nextId++
      setToasts((t) => [...t, { id, kind, message }])
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id))
      }, 4000)
    }
    return () => {
      pushToast = null
    }
  }, [])

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icons[t.kind]
        return (
          <div
            key={t.id}
            className={`flex items-center gap-2.5 rounded-xl border bg-slate-900/95 px-4 py-3 text-sm shadow-xl shadow-black/40 backdrop-blur ${colors[t.kind]}`}
          >
            <Icon size={18} />
            <span className="text-slate-200">{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}
