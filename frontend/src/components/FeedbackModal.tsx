import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2, Camera } from 'lucide-react'
import toast from 'react-hot-toast'

import { Modal } from './ui/Modal'
import { pb } from '../lib/pocketbase'
import { useAuth } from '../contexts/AuthContext'

const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024 // 5MB

const CATEGORIES = [
  { value: 'bug', label: 'Bug' },
  { value: 'text-change', label: 'Text Change' },
  { value: 'feature-request', label: 'Feature Request' },
  { value: 'question', label: 'Question' },
] as const

type Category = (typeof CATEGORIES)[number]['value']

interface FeedbackModalProps {
  isOpen: boolean
  onClose: () => void
}

export function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const { isLoading: isAuthLoading } = useAuth()
  const [category, setCategory] = useState<Category | null>(null)
  const [description, setDescription] = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [fileSizeError, setFileSizeError] = useState(false)

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!category) return
      const formData = new FormData()
      formData.append('category', category)
      formData.append('description', description)
      formData.append('page_url', window.location.pathname)
      formData.append('browser', navigator.userAgent)
      formData.append('viewport', `${window.innerWidth}x${window.innerHeight}`)
      formData.append('app_version', import.meta.env.VITE_APP_VERSION || 'dev')

      if (screenshot) {
        formData.append('screenshot', screenshot)
      }

      const response = await pb.send('/api/custom/feedback', {
        method: 'POST',
        body: formData,
      })
      return response
    },
    onSuccess: () => {
      toast.success('Feedback submitted — thank you!')
      resetForm()
      onClose()
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to submit feedback. Please try again.')
    },
  })

  const resetForm = () => {
    setCategory(null)
    setDescription('')
    setScreenshot(null)
    setFileSizeError(false)
  }

  const handleClose = () => {
    if (!submitMutation.isPending) {
      resetForm()
      submitMutation.reset()
      onClose()
    }
  }

  // Reset form when modal is reopened
  useEffect(() => {
    if (isOpen) {
      resetForm()
      submitMutation.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (file && file.size > MAX_SCREENSHOT_SIZE) {
      setFileSizeError(true)
      setScreenshot(null)
      return
    }
    setFileSizeError(false)
    setScreenshot(file)
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.files
    if (!items || items.length === 0) return

    const imageFile = Array.from(items).find((f) => f.type.startsWith('image/'))
    if (!imageFile) return

    if (imageFile.size > MAX_SCREENSHOT_SIZE) {
      setFileSizeError(true)
      setScreenshot(null)
      return
    }

    // Create a named file from the clipboard blob
    const named = new File(
      [imageFile],
      `pasted-screenshot.${imageFile.type.split('/')[1] || 'png'}`,
      {
        type: imageFile.type,
      }
    )
    setFileSizeError(false)
    setScreenshot(named)
  }

  const canSubmit =
    category !== null && description.trim() !== '' && !submitMutation.isPending && !isAuthLoading

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Report a Problem" size="md">
      {/* Category picker — a button group, not a single form control, so this
          is a group label (span + aria-labelledby) rather than a <label>,
          which would need a control to associate with. */}
      <div className="mb-4">
        <span
          id="feedback-category-label"
          className="text-foreground mb-2 block text-sm font-medium"
        >
          Category
        </span>
        <div
          role="group"
          aria-labelledby="feedback-category-label"
          className="grid grid-cols-2 gap-2"
        >
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setCategory(cat.value)}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                category === cat.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-foreground hover:bg-muted'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div className="mb-4">
        <label
          htmlFor="feedback-description"
          className="text-foreground mb-2 block text-sm font-medium"
        >
          Description
        </label>
        <textarea
          id="feedback-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onPaste={handlePaste}
          placeholder="What happened? What did you expect?"
          rows={4}
          className="border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary w-full rounded-xl border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
        />
      </div>

      {/* Screenshot */}
      <div className="mb-6">
        <label
          htmlFor="feedback-screenshot"
          className="text-foreground mb-2 flex items-center gap-2 text-sm font-medium"
        >
          <Camera className="h-4 w-4" />
          Screenshot (optional)
        </label>
        <input
          id="feedback-screenshot"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          aria-label="Screenshot"
          className="text-foreground file:bg-muted file:text-foreground file:border-border w-full text-sm file:mr-3 file:rounded-lg file:border file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        {fileSizeError && <p className="mt-1 text-sm text-red-500">Screenshot must be under 5MB</p>}
        {screenshot && !fileSizeError && (
          <p className="text-muted-foreground mt-1 text-sm">{screenshot.name}</p>
        )}
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={() => submitMutation.mutate()}
        disabled={!canSubmit}
        aria-label="Submit"
        className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitMutation.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          'Submit'
        )}
      </button>
    </Modal>
  )
}
