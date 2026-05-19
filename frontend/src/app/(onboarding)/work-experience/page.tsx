'use client'

import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useOnboardingStore } from '@/store/onboarding'

const workExpSchema = z.object({
  company: z.string().min(1, 'Company is required'),
  title: z.string().min(1, 'Job title is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  current: z.boolean(),
  description: z.string().optional(),
})

const schema = z.object({
  workExperiences: z
    .array(workExpSchema)
    .min(1, 'At least one work experience entry is required'),
})

type FormValues = z.infer<typeof schema>

export default function WorkExperiencePage() {
  const router = useRouter()
  const { workExperiences, setWorkExperiences, setCurrentStep } = useOnboardingStore()

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      workExperiences:
        workExperiences.length > 0
          ? workExperiences
          : [
              {
                company: '',
                title: '',
                startDate: '',
                endDate: '',
                current: false,
                description: '',
              },
            ],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'workExperiences',
  })

  const watchedFields = watch('workExperiences')

  const onSubmit = (data: FormValues) => {
    setWorkExperiences(data.workExperiences)
    setCurrentStep(2)
    router.push('/education')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Work Experience</h2>
      <p className="text-gray-500 mb-6">Add your relevant professional experience.</p>

      {errors.workExperiences?.root && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {errors.workExperiences.root.message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        {fields.map((field, idx) => {
          const isCurrent = watchedFields?.[idx]?.current ?? false
          const expErrors = errors.workExperiences?.[idx]

          return (
            <div key={field.id} className="border border-gray-200 rounded-lg p-5 bg-gray-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">
                  Experience #{idx + 1}
                </h3>
                {fields.length > 1 && (
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className="text-red-500 hover:text-red-700 text-xs font-medium"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Company <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register(`workExperiences.${idx}.company`)}
                    type="text"
                    placeholder="Acme Corp"
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      expErrors?.company ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  {expErrors?.company && (
                    <p className="text-red-500 text-xs mt-1">{expErrors.company.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Job Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register(`workExperiences.${idx}.title`)}
                    type="text"
                    placeholder="Software Engineer"
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      expErrors?.title ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  {expErrors?.title && (
                    <p className="text-red-500 text-xs mt-1">{expErrors.title.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register(`workExperiences.${idx}.startDate`)}
                    type="month"
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      expErrors?.startDate ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  {expErrors?.startDate && (
                    <p className="text-red-500 text-xs mt-1">{expErrors.startDate.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    {...register(`workExperiences.${idx}.endDate`)}
                    type="month"
                    disabled={isCurrent}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:bg-gray-100"
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  {...register(`workExperiences.${idx}.current`)}
                  type="checkbox"
                  id={`current-${idx}`}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                <label htmlFor={`current-${idx}`} className="text-sm text-gray-700">
                  I currently work here
                </label>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  {...register(`workExperiences.${idx}.description`)}
                  rows={3}
                  placeholder="Describe your responsibilities and achievements..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() =>
            append({ company: '', title: '', startDate: '', endDate: '', current: false, description: '' })
          }
          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + Add Another Experience
        </button>

        <div className="flex justify-between pt-4">
          <button
            type="button"
            onClick={() => {
              setCurrentStep(0)
              router.push('/personal-info')
            }}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            ← Back
          </button>
          <button
            type="submit"
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Next: Education →
          </button>
        </div>
      </form>
    </div>
  )
}
