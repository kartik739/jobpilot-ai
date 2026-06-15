'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  getInterviewPrepSheet,
  addCustomQuestion,
  updateQuestionNote,
  type PrepQuestion,
  type QuestionCategory,
  type InterviewPrepSheet,
} from '@/lib/applications-api'

// ─── Form schemas ─────────────────────────────────────────────────────────────

const addQuestionSchema = z.object({
  question: z.string().min(3, 'Question must be at least 3 characters'),
  category: z.enum(['behavioral', 'technical', 'culture', 'system-design'] as const),
})

type AddQuestionFormValues = z.infer<typeof addQuestionSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function categoryLabel(category: QuestionCategory): string {
  switch (category) {
    case 'behavioral':
      return 'Behavioral'
    case 'technical':
      return 'Technical'
    case 'culture':
      return 'Culture Fit'
    case 'system-design':
      return 'System Design'
    default:
      return category
  }
}

function categoryColors(category: QuestionCategory): string {
  switch (category) {
    case 'behavioral':
      return 'bg-purple-100 text-purple-800 border-purple-200'
    case 'technical':
      return 'bg-blue-100 text-blue-800 border-blue-200'
    case 'culture':
      return 'bg-green-100 text-green-800 border-green-200'
    case 'system-design':
      return 'bg-orange-100 text-orange-800 border-orange-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading interview prep">
      <div className="h-7 w-72 bg-gray-200 rounded" />
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="h-5 w-48 bg-gray-200 rounded" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="border border-gray-100 rounded-lg p-4 space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="h-3 bg-gray-100 rounded w-1/4" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-5 py-4"
    >
      <span aria-hidden="true" className="text-lg leading-none mt-0.5">⚠</span>
      <div>
        <p className="font-semibold text-sm">Failed to load interview prep</p>
        <p className="text-sm mt-0.5 text-red-600">{message}</p>
        <p className="text-sm mt-2 text-gray-600">
          The interview prep sheet may not have been generated yet. Check that the AI agent has run for this application.
        </p>
      </div>
    </div>
  )
}

// ─── Category badge ───────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: QuestionCategory }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${categoryColors(category)}`}
      aria-label={`Category: ${categoryLabel(category)}`}
    >
      {categoryLabel(category)}
    </span>
  )
}

// ─── Question note editor ─────────────────────────────────────────────────────

interface NoteEditorProps {
  applicationId: string
  index: number
  category: QuestionCategory
  currentNote: string | undefined
  onSaved: () => void
}

function NoteEditor({ applicationId, index, category, currentNote, onSaved }: NoteEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(currentNote ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const noteMutation = useMutation({
    mutationFn: (note: string) =>
      updateQuestionNote(applicationId, index, { category, note }),
    onSuccess: () => {
      setIsEditing(false)
      setSaveError(null)
      setSaveSuccess(true)
      onSaved()
      setTimeout(() => setSaveSuccess(false), 3000)
    },
    onError: (err: Error) => {
      setSaveError(err.message ?? 'Failed to save note.')
    },
  })

  const handleSave = () => {
    setSaveError(null)
    noteMutation.mutate(draft)
  }

  const handleCancel = () => {
    setDraft(currentNote ?? '')
    setIsEditing(false)
    setSaveError(null)
  }

  if (isEditing) {
    return (
      <div className="mt-3 space-y-2">
        <label
          htmlFor={`note-${category}-${index}`}
          className="block text-xs font-medium text-gray-600"
        >
          Your notes
        </label>
        <textarea
          id={`note-${category}-${index}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          disabled={noteMutation.isPending}
          placeholder="Add your personal notes for this question…"
          className="w-full px-3 py-2 text-sm text-gray-800 bg-white border border-gray-300 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          aria-label="Question note"
        />

        {saveError && (
          <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
            {saveError}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={noteMutation.isPending}
            aria-busy={noteMutation.isPending}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 transition-colors"
          >
            {noteMutation.isPending ? (
              <>
                <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : 'Save'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={noteMutation.isPending}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3">
      {saveSuccess && (
        <p role="status" className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2.5 py-1.5 mb-2">
          Note saved.
        </p>
      )}

      {currentNote ? (
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <p className="text-xs font-medium text-amber-700 mb-1">📝 Your notes</p>
            <p className="text-sm text-amber-900 whitespace-pre-line">{currentNote}</p>
          </div>
          <button
            type="button"
            onClick={() => { setDraft(currentNote); setIsEditing(true) }}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 rounded shrink-0"
            aria-label="Edit note"
          >
            Edit
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="text-xs text-gray-400 hover:text-gray-600 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors"
          aria-label="Add a note for this question"
        >
          + Add note
        </button>
      )}
    </div>
  )
}

// ─── Expandable question card ─────────────────────────────────────────────────

interface QuestionCardProps {
  question: PrepQuestion
  index: number
  applicationId: string
  onNoteSaved: () => void
}

function QuestionCard({ question, index, applicationId, onNoteSaved }: QuestionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const panelId = `question-panel-${question.category}-${index}`
  const headerId = `question-header-${question.category}-${index}`

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Accordion header */}
      <button
        id={headerId}
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className="w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-xs font-semibold text-gray-400 tabular-nums">Q{index + 1}</span>
            <CategoryBadge category={question.category} />
            {question.note && (
              <span className="text-xs text-amber-600 font-medium" aria-label="Has a note">
                📝
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-800 leading-snug">{question.question}</p>
        </div>
        <span
          className={`shrink-0 text-gray-400 text-sm transition-transform duration-200 mt-0.5 ${isExpanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {/* Accordion panel */}
      {isExpanded && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="border-t border-gray-100 px-4 py-4 bg-gray-50 space-y-3"
        >
          {/* Suggested answer */}
          {question.suggestedAnswer ? (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                💡 Suggested Answer
              </p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                {question.suggestedAnswer}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">No suggested answer for this question.</p>
          )}

          {/* Divider */}
          <hr className="border-gray-200" />

          {/* Notes editor */}
          <NoteEditor
            applicationId={applicationId}
            index={index}
            category={question.category}
            currentNote={question.note}
            onSaved={onNoteSaved}
          />
        </div>
      )}
    </div>
  )
}

// ─── Questions section ────────────────────────────────────────────────────────

interface QuestionsSectionProps {
  title: string
  icon: string
  questions: PrepQuestion[]
  applicationId: string
  onNoteSaved: () => void
  sectionId: string
}

function QuestionsSection({
  title,
  icon,
  questions,
  applicationId,
  onNoteSaved,
  sectionId,
}: QuestionsSectionProps) {
  const headingId = `${sectionId}-heading`

  return (
    <section
      aria-labelledby={headingId}
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm"
    >
      <h2 id={headingId} className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span aria-hidden="true">{icon}</span>
        {title}
        <span className="ml-auto text-xs font-normal text-gray-400">
          {questions.length} {questions.length === 1 ? 'question' : 'questions'}
        </span>
      </h2>

      {questions.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No questions in this section.</p>
      ) : (
        <div className="space-y-2" role="list" aria-label={`${title} questions`}>
          {questions.map((q, i) => (
            <div key={`${q.category}-${i}`} role="listitem">
              <QuestionCard
                question={q}
                index={i}
                applicationId={applicationId}
                onNoteSaved={onNoteSaved}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Company summary section ──────────────────────────────────────────────────

function CompanySummarySection({ summary, tips }: { summary: string; tips: string[] }) {
  if (!summary && tips.length === 0) return null

  return (
    <section
      aria-labelledby="company-summary-heading"
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm"
    >
      <h2
        id="company-summary-heading"
        className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2"
      >
        <span aria-hidden="true">🏢</span>
        Company & Role Overview
      </h2>

      {summary && (
        <p className="text-sm text-gray-700 leading-relaxed mb-4">{summary}</p>
      )}

      {tips.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Role-Specific Tips
          </p>
          <ul className="space-y-2" aria-label="Role-specific tips">
            {tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-green-500 mt-0.5 shrink-0" aria-hidden="true">✓</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// ─── Add custom question form ─────────────────────────────────────────────────

interface AddQuestionFormProps {
  applicationId: string
  onAdded: () => void
}

function AddQuestionForm({ applicationId, onAdded }: AddQuestionFormProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddQuestionFormValues>({
    resolver: zodResolver(addQuestionSchema),
    defaultValues: { category: 'technical' },
  })

  const addMutation = useMutation({
    mutationFn: (values: AddQuestionFormValues) =>
      addCustomQuestion(applicationId, {
        question: values.question,
        category: values.category,
      }),
    onSuccess: () => {
      reset()
      setIsOpen(false)
      setAddError(null)
      onAdded()
    },
    onError: (err: Error) => {
      setAddError(err.message ?? 'Failed to add question.')
    },
  })

  const onSubmit = handleSubmit((values) => {
    setAddError(null)
    addMutation.mutate(values)
  })

  if (!isOpen) {
    return (
      <div className="bg-white border border-dashed border-gray-300 rounded-xl p-4 text-center">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors"
          aria-label="Add a custom interview question"
        >
          <span aria-hidden="true" className="text-lg leading-none">+</span>
          Add Custom Question
        </button>
      </div>
    )
  }

  return (
    <section
      aria-labelledby="add-question-heading"
      className="bg-white border border-blue-200 rounded-xl p-5 shadow-sm"
    >
      <h2
        id="add-question-heading"
        className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2"
      >
        <span aria-hidden="true">➕</span>
        Add Custom Question
      </h2>

      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Add custom question form">
        {/* Question text */}
        <div className="space-y-1">
          <label htmlFor="custom-question-text" className="block text-sm font-medium text-gray-700">
            Question <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input
            id="custom-question-text"
            type="text"
            {...register('question')}
            placeholder="e.g. How do you handle conflicting priorities?"
            disabled={addMutation.isPending}
            aria-describedby={errors.question ? 'custom-question-error' : undefined}
            className={`w-full px-3 py-2 text-sm text-gray-800 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
              errors.question ? 'border-red-400' : 'border-gray-300'
            }`}
          />
          {errors.question && (
            <p id="custom-question-error" role="alert" className="text-xs text-red-600">
              {errors.question.message}
            </p>
          )}
        </div>

        {/* Category */}
        <div className="space-y-1">
          <label htmlFor="custom-question-category" className="block text-sm font-medium text-gray-700">
            Category
          </label>
          <select
            id="custom-question-category"
            {...register('category')}
            disabled={addMutation.isPending}
            className="w-full px-3 py-2 text-sm text-gray-800 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option value="technical">Technical</option>
            <option value="behavioral">Behavioral</option>
            <option value="culture">Culture Fit</option>
            <option value="system-design">System Design</option>
          </select>
        </div>

        {/* Error */}
        {addError && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {addError}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={addMutation.isPending}
            aria-busy={addMutation.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {addMutation.isPending ? (
              <>
                <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" aria-hidden="true" />
                Adding…
              </>
            ) : 'Add Question'}
          </button>
          <button
            type="button"
            onClick={() => { reset(); setIsOpen(false); setAddError(null) }}
            disabled={addMutation.isPending}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  )
}

// ─── Interview prep stats bar ─────────────────────────────────────────────────

function StatsBar({ sheet }: { sheet: InterviewPrepSheet }) {
  const behavioral = sheet.behavioralQuestions.length
  const technical = sheet.technicalQuestions.length
  const total = behavioral + technical
  const withAnswers = [
    ...sheet.behavioralQuestions,
    ...sheet.technicalQuestions,
  ].filter((q) => q.suggestedAnswer).length
  const withNotes = [
    ...sheet.behavioralQuestions,
    ...sheet.technicalQuestions,
  ].filter((q) => q.note).length

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="region" aria-label="Interview prep summary">
      {[
        { label: 'Total Questions', value: total, icon: '❓' },
        { label: 'Behavioral', value: behavioral, icon: '🧠' },
        { label: 'Technical', value: technical, icon: '⚙️' },
        { label: 'With Answers', value: withAnswers, icon: '💡' },
      ].map(({ label, value, icon }) => (
        <div
          key={label}
          className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm text-center"
        >
          <div className="text-xl" aria-hidden="true">{icon}</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{value}</div>
          <div className="text-xs text-gray-500 mt-0.5">{label}</div>
        </div>
      ))}
      {withNotes > 0 && (
        <div className="col-span-2 sm:col-span-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-center">
          <p className="text-sm text-amber-800">
            <span aria-hidden="true">📝 </span>
            You have notes on {withNotes} {withNotes === 1 ? 'question' : 'questions'}.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function InterviewPrepPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const applicationId = typeof params?.id === 'string' ? params.id : (params?.id?.[0] ?? '')

  const { data: sheet, isLoading, isError, error } = useQuery({
    queryKey: ['interviewPrep', applicationId],
    queryFn: () => getInterviewPrepSheet(applicationId),
    enabled: Boolean(applicationId),
    retry: 1,
  })

  const handleDataChange = () => {
    queryClient.invalidateQueries({ queryKey: ['interviewPrep', applicationId] })
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back navigation */}
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors"
        aria-label="Go back"
      >
        <span aria-hidden="true">←</span>
        Back
      </button>

      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span aria-hidden="true">🎯</span>
          Interview Prep
        </h1>
        {sheet && (
          <p className="text-gray-500 text-sm mt-1">
            Generated {formatDate(sheet.generatedAt)}
          </p>
        )}
      </div>

      {/* Loading */}
      {isLoading && <LoadingSkeleton />}

      {/* Error */}
      {isError && (
        <ErrorState message={(error as Error | null)?.message ?? 'An unexpected error occurred.'} />
      )}

      {/* Content */}
      {!isLoading && !isError && sheet && (
        <>
          {/* Stats */}
          <StatsBar sheet={sheet} />

          {/* Company summary & tips */}
          <CompanySummarySection
            summary={sheet.companySummary}
            tips={sheet.roleSpecificTips}
          />

          {/* Behavioral questions */}
          <QuestionsSection
            sectionId="behavioral"
            title="Behavioral Questions"
            icon="🧠"
            questions={sheet.behavioralQuestions}
            applicationId={applicationId}
            onNoteSaved={handleDataChange}
          />

          {/* Technical questions */}
          <QuestionsSection
            sectionId="technical"
            title="Technical Questions"
            icon="⚙️"
            questions={sheet.technicalQuestions}
            applicationId={applicationId}
            onNoteSaved={handleDataChange}
          />

          {/* Add custom question */}
          <AddQuestionForm
            applicationId={applicationId}
            onAdded={handleDataChange}
          />
        </>
      )}
    </div>
  )
}
