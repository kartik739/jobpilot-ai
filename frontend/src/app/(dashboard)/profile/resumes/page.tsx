'use client'

import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getResumes,
  uploadResume,
  updateResume,
  deleteResume,
  getResumeDownloadUrl,
  ResumeVersion,
} from '@/lib/profile-api'

// ─── Constants ────────────────────────────────────────────────────────────────

const SPECIALIZATIONS = [
  { value: 'backend', label: 'Backend' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'fullstack', label: 'Full Stack' },
  { value: 'devops', label: 'DevOps' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'ai_ml', label: 'AI / ML' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'data', label: 'Data' },
  { value: 'general', label: 'General' },
] as const

type SpecializationValue = (typeof SPECIALIZATIONS)[number]['value']

const SPECIALIZATION_COLORS: Record<SpecializationValue, string> = {
  backend: 'bg-purple-100 text-purple-700',
  frontend: 'bg-blue-100 text-blue-700',
  fullstack: 'bg-indigo-100 text-indigo-700',
  devops: 'bg-orange-100 text-orange-700',
  cloud: 'bg-cyan-100 text-cyan-700',
  ai_ml: 'bg-pink-100 text-pink-700',
  mobile: 'bg-green-100 text-green-700',
  data: 'bg-yellow-100 text-yellow-700',
  general: 'bg-gray-100 text-gray-700',
}

function specializationLabel(value: string): string {
  return SPECIALIZATIONS.find((s) => s.value === value)?.label ?? value
}

function specializationColor(value: string): string {
  return SPECIALIZATION_COLORS[value as SpecializationValue] ?? 'bg-gray-100 text-gray-700'
}

// ─── Upload form schema ───────────────────────────────────────────────────────

const uploadSchema = z.object({
  name: z.string().min(1, 'Resume name is required'),
  specialization: z.enum(
    ['backend', 'frontend', 'fullstack', 'devops', 'cloud', 'ai_ml', 'mobile', 'data', 'general'],
    { required_error: 'Specialization is required' }
  ),
  file: z
    .custom<File>((v) => v instanceof File, 'PDF file is required')
    .refine((f) => f.type === 'application/pdf', 'File must be a PDF'),
})

type UploadFormValues = z.infer<typeof uploadSchema>

// ─── Resume Card ──────────────────────────────────────────────────────────────

interface ResumeCardProps {
  resume: ResumeVersion
  onSetDefault: (id: string) => void
  onDelete: (id: string) => void
  isSettingDefault: boolean
  isDeleting: boolean
}

function ResumeCard({ resume, onSetDefault, onDelete, isSettingDefault, isDeleting }: ResumeCardProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const handleDownload = async () => {
    setIsDownloading(true)
    setDownloadError(null)
    try {
      const url = await getResumeDownloadUrl(resume.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setDownloadError('Failed to get download link. Please try again.')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleDeleteClick = () => {
    if (window.confirm(`Delete "${resume.name}"? This cannot be undone.`)) {
      onDelete(resume.id)
    }
  }

  const createdDate = new Date(resume.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  const lastUsedDate = resume.lastUsedAt
    ? new Date(resume.lastUsedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3 shadow-sm">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-lg">📄</span>
          <h3 className="font-semibold text-gray-900 truncate">{resume.name}</h3>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${specializationColor(resume.specialization)}`}
          >
            {specializationLabel(resume.specialization)}
          </span>
          {resume.isDefault && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-600 text-white">
              Default
            </span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <span>Uploaded {createdDate}</span>
        <span>Used {resume.usageCount} time{resume.usageCount !== 1 ? 's' : ''}</span>
        {lastUsedDate && <span>Last used {lastUsedDate}</span>}
        {resume.successRate != null && (
          <span className="text-green-600 font-medium">
            {Math.round(resume.successRate * 100)}% success rate
          </span>
        )}
      </div>

      {downloadError && (
        <p className="text-xs text-red-500" role="alert">{downloadError}</p>
      )}

      {/* Actions row */}
      <div className="flex flex-wrap gap-2 mt-1">
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          aria-label={`Download ${resume.name}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {isDownloading ? '⏳ Downloading…' : '⬇ Download'}
        </button>

        {!resume.isDefault && (
          <button
            type="button"
            onClick={() => onSetDefault(resume.id)}
            disabled={isSettingDefault}
            aria-label={`Set ${resume.name} as default resume`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {isSettingDefault ? '⏳ Setting…' : '★ Set as Default'}
          </button>
        )}

        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={isDeleting}
          aria-label={`Delete ${resume.name}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-red-300 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ml-auto"
        >
          {isDeleting ? '⏳ Deleting…' : '🗑 Delete'}
        </button>
      </div>
    </div>
  )
}

// ─── Upload Form ──────────────────────────────────────────────────────────────

interface UploadFormProps {
  onSuccess: () => void
}

function UploadForm({ onSuccess }: UploadFormProps) {
  const [dragActive, setDragActive] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
  })

  const mutation = useMutation({
    mutationFn: (values: UploadFormValues) => {
      const fd = new FormData()
      fd.append('name', values.name)
      fd.append('specialization', values.specialization)
      fd.append('resume', values.file)
      return uploadResume(fd)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      reset()
      setSelectedFileName('')
      setUploadError(null)
      onSuccess()
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Upload failed. Please try again.'
      setUploadError(message)
    },
  })

  const handleFileChange = (file: File | null) => {
    if (file) {
      setSelectedFileName(file.name)
      setValue('file', file, { shouldValidate: true })
    }
  }

  const onSubmit = (values: UploadFormValues) => {
    setUploadError(null)
    mutation.mutate(values)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {uploadError && (
        <div
          role="alert"
          className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg"
        >
          <span className="mt-0.5">⚠</span>
          <span>{uploadError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Resume Name */}
        <div>
          <label htmlFor="resume-name" className="block text-sm font-medium text-gray-700 mb-1">
            Resume Name <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input
            id="resume-name"
            {...register('name')}
            type="text"
            placeholder="e.g. Senior Backend Resume 2024"
            autoComplete="off"
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.name ? 'border-red-400' : 'border-gray-300'
            }`}
          />
          {errors.name && (
            <p className="text-red-500 text-xs mt-1" role="alert">{errors.name.message}</p>
          )}
        </div>

        {/* Specialization */}
        <div>
          <label htmlFor="resume-specialization" className="block text-sm font-medium text-gray-700 mb-1">
            Specialization <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <select
            id="resume-specialization"
            {...register('specialization')}
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${
              errors.specialization ? 'border-red-400' : 'border-gray-300'
            }`}
          >
            <option value="">Select a specialization…</option>
            {SPECIALIZATIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {errors.specialization && (
            <p className="text-red-500 text-xs mt-1" role="alert">{errors.specialization.message}</p>
          )}
        </div>
      </div>

      {/* File Upload */}
      <div>
        <label htmlFor="resume-file" className="block text-sm font-medium text-gray-700 mb-1">
          Resume PDF <span className="text-red-500" aria-hidden="true">*</span>
        </label>
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload resume PDF — click or drag and drop"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
          }}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragActive(false)
            const file = e.dataTransfer.files?.[0]
            if (file) handleFileChange(file)
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragActive
              ? 'border-blue-500 bg-blue-50'
              : errors.file
              ? 'border-red-400 bg-red-50'
              : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
          }`}
        >
          <input
            ref={inputRef}
            id="resume-file"
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            aria-describedby={errors.file ? 'resume-file-error' : undefined}
          />
          <div className="text-3xl mb-1">📄</div>
          {selectedFileName ? (
            <p className="text-sm font-medium text-green-700">✓ {selectedFileName}</p>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-700">Drop your PDF here or click to browse</p>
              <p className="text-xs text-gray-400 mt-0.5">PDF files only</p>
            </>
          )}
        </div>
        {errors.file && (
          <p id="resume-file-error" className="text-red-500 text-xs mt-1" role="alert">
            {errors.file.message as string}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={mutation.isPending}
          aria-label="Upload resume"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
          {mutation.isPending ? '⏳ Uploading…' : '⬆ Upload Resume'}
        </button>
      </div>
    </form>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ResumesPage() {
  const [uploadOpen, setUploadOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data: resumes, isLoading, isError } = useQuery({
    queryKey: ['resumes'],
    queryFn: getResumes,
    retry: 1,
  })

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => updateResume(id, { isDefault: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resumes'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteResume(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resumes'] }),
  })

  const [mutationError, setMutationError] = useState<string | null>(null)

  const handleSetDefault = (id: string) => {
    setMutationError(null)
    setDefaultMutation.mutate(id, {
      onError: () => setMutationError('Failed to update default. Please try again.'),
    })
  }

  const handleDelete = (id: string) => {
    setMutationError(null)
    deleteMutation.mutate(id, {
      onError: () => setMutationError('Failed to delete resume. Please try again.'),
    })
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resumes</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage your resume versions for different job specializations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setUploadOpen((v) => !v)}
          aria-expanded={uploadOpen}
          aria-controls="upload-section"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors flex-shrink-0"
        >
          {uploadOpen ? '✕ Close' : '+ Upload Resume'}
        </button>
      </div>

      {/* Upload form collapsible section */}
      {uploadOpen && (
        <div
          id="upload-section"
          className="mb-6 bg-gray-50 border border-gray-200 rounded-xl p-6"
        >
          <h2 className="text-base font-semibold text-gray-800 mb-4">Upload New Resume</h2>
          <UploadForm onSuccess={() => setUploadOpen(false)} />
        </div>
      )}

      {/* Mutation error banner */}
      {mutationError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg"
        >
          <span className="mt-0.5">⚠</span>
          <span>{mutationError}</span>
        </div>
      )}

      {/* Resume list */}
      {isLoading && (
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="text-gray-400 text-sm">Loading resumes…</div>
        </div>
      )}

      {isError && (
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="text-red-500 text-sm">Failed to load resumes. Please refresh the page.</div>
        </div>
      )}

      {!isLoading && !isError && resumes && resumes.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[200px] text-center border-2 border-dashed border-gray-200 rounded-xl py-12 px-6">
          <div className="text-4xl mb-3">📄</div>
          <p className="text-gray-600 font-medium">No resumes yet</p>
          <p className="text-gray-400 text-sm mt-1">
            Upload your first resume to get started.
          </p>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            + Upload Resume
          </button>
        </div>
      )}

      {!isLoading && !isError && resumes && resumes.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {/* Default first, then sorted by createdAt descending */}
          {[...resumes]
            .sort((a, b) => {
              if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            })
            .map((resume) => (
              <ResumeCard
                key={resume.id}
                resume={resume}
                onSetDefault={handleSetDefault}
                onDelete={handleDelete}
                isSettingDefault={
                  setDefaultMutation.isPending && setDefaultMutation.variables === resume.id
                }
                isDeleting={
                  deleteMutation.isPending && deleteMutation.variables === resume.id
                }
              />
            ))}
        </div>
      )}
    </div>
  )
}
