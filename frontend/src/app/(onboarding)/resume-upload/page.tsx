'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useState, useRef } from 'react'
import { useOnboardingStore } from '@/store/onboarding'

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

const schema = z.object({
  name: z.string().min(1, 'Resume name is required'),
  specialization: z.enum(
    ['backend', 'frontend', 'fullstack', 'devops', 'cloud', 'ai_ml', 'mobile', 'data', 'general'],
    { required_error: 'Specialization is required' }
  ),
  file: z
    .custom<File>((v) => v instanceof File, 'PDF file is required')
    .refine((f) => f.type === 'application/pdf', 'File must be a PDF'),
})

type FormValues = z.infer<typeof schema>

export default function ResumeUploadPage() {
  const router = useRouter()
  const { resumeUpload, setResumeUpload, setCurrentStep } = useOnboardingStore()
  const [dragActive, setDragActive] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState(resumeUpload?.fileName ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: resumeUpload?.name ?? '',
      specialization: resumeUpload?.specialization ?? undefined,
    },
  })

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const onSubmit = async (data: FormValues) => {
    const base64 = await readFileAsBase64(data.file)
    setResumeUpload({
      fileName: data.file.name,
      fileBase64: base64,
      specialization: data.specialization,
      name: data.name,
    })
    setCurrentStep(6)
    router.push('/preferences')
  }

  const handleFileChange = (file: File | null) => {
    if (file) {
      setSelectedFileName(file.name)
      setValue('file', file, { shouldValidate: true })
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Resume Upload</h2>
      <p className="text-gray-500 mb-6">Upload your resume PDF and tag it with a specialization.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        {/* Resume Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Resume Name <span className="text-red-500">*</span>
          </label>
          <input
            {...register('name')}
            type="text"
            placeholder="e.g. Senior Backend Resume 2024"
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.name ? 'border-red-400' : 'border-gray-300'
            }`}
          />
          {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
        </div>

        {/* Specialization */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Specialization <span className="text-red-500">*</span>
          </label>
          <select
            {...register('specialization')}
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${
              errors.specialization ? 'border-red-400' : 'border-gray-300'
            }`}
          >
            <option value="">Select a specialization...</option>
            {SPECIALIZATIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {errors.specialization && (
            <p className="text-red-500 text-xs mt-1">{errors.specialization.message}</p>
          )}
        </div>

        {/* File Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Resume PDF <span className="text-red-500">*</span>
          </label>
          <Controller
            name="file"
            control={control}
            render={() => (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragActive(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file) handleFileChange(file)
                }}
                onClick={() => inputRef.current?.click()}
                className={`cursor-pointer border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive
                    ? 'border-blue-500 bg-blue-50'
                    : errors.file
                    ? 'border-red-400 bg-red-50'
                    : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
                }`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                />
                <div className="text-4xl mb-2">📄</div>
                {selectedFileName ? (
                  <p className="text-sm font-medium text-green-700">✓ {selectedFileName}</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-700">
                      Drop your PDF here or click to browse
                    </p>
                    <p className="text-xs text-gray-400 mt-1">PDF files only</p>
                  </>
                )}
              </div>
            )}
          />
          {errors.file && (
            <p className="text-red-500 text-xs mt-1">{errors.file.message as string}</p>
          )}
        </div>

        <div className="flex justify-between pt-4">
          <button
            type="button"
            onClick={() => {
              setCurrentStep(4)
              router.push('/skills')
            }}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            ← Back
          </button>
          <button
            type="submit"
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Next: Preferences →
          </button>
        </div>
      </form>
    </div>
  )
}
