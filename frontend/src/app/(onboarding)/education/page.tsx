'use client'

import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useOnboardingStore } from '@/store/onboarding'

const educationSchema = z.object({
  institution: z.string().min(1, 'Institution is required'),
  degree: z.string().min(1, 'Degree is required'),
  field: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

const schema = z.object({
  educations: z.array(educationSchema).min(1, 'At least one education entry is required'),
})

type FormValues = z.infer<typeof schema>

export default function EducationPage() {
  const router = useRouter()
  const { educations, setEducations, setCurrentStep } = useOnboardingStore()

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      educations:
        educations.length > 0
          ? educations
          : [{ institution: '', degree: '', field: '', startDate: '', endDate: '' }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'educations' })

  const onSubmit = (data: FormValues) => {
    setEducations(data.educations)
    setCurrentStep(3)
    router.push('/projects')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Education</h2>
      <p className="text-gray-500 mb-6">Add your educational background.</p>

      {errors.educations?.root && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {errors.educations.root.message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        {fields.map((field, idx) => {
          const eduErrors = errors.educations?.[idx]

          return (
            <div key={field.id} className="border border-gray-200 rounded-lg p-5 bg-gray-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">Education #{idx + 1}</h3>
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
                    Institution <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register(`educations.${idx}.institution`)}
                    type="text"
                    placeholder="MIT"
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      eduErrors?.institution ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  {eduErrors?.institution && (
                    <p className="text-red-500 text-xs mt-1">{eduErrors.institution.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Degree <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...register(`educations.${idx}.degree`)}
                    type="text"
                    placeholder="B.S. Computer Science"
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      eduErrors?.degree ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                  {eduErrors?.degree && (
                    <p className="text-red-500 text-xs mt-1">{eduErrors.degree.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Field of Study</label>
                  <input
                    {...register(`educations.${idx}.field`)}
                    type="text"
                    placeholder="Computer Science"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
                    <input
                      {...register(`educations.${idx}.startDate`)}
                      type="month"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
                    <input
                      {...register(`educations.${idx}.endDate`)}
                      type="month"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() => append({ institution: '', degree: '', field: '', startDate: '', endDate: '' })}
          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + Add Another Education
        </button>

        <div className="flex justify-between pt-4">
          <button
            type="button"
            onClick={() => {
              setCurrentStep(1)
              router.push('/work-experience')
            }}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            ← Back
          </button>
          <button
            type="submit"
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Next: Projects →
          </button>
        </div>
      </form>
    </div>
  )
}
