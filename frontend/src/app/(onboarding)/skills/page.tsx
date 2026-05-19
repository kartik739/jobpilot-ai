'use client'

import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useOnboardingStore } from '@/store/onboarding'

const schema = z.object({
  skills: z.array(z.object({ name: z.string().min(1, 'Skill name is required') }))
    .min(1, 'At least one skill is required'),
})

type FormValues = z.infer<typeof schema>

export default function SkillsPage() {
  const router = useRouter()
  const { skills, setSkills, setCurrentStep } = useOnboardingStore()

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      skills: skills.length > 0 ? skills : [{ name: '' }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'skills' })

  const onSubmit = (data: FormValues) => {
    setSkills(data.skills)
    setCurrentStep(5)
    router.push('/resume-upload')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Skills</h2>
      <p className="text-gray-500 mb-6">List your technical and professional skills.</p>

      {errors.skills?.root && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {errors.skills.root.message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {fields.map((field, idx) => (
            <div key={field.id} className="flex items-start gap-2">
              <div className="flex-1">
                <input
                  {...register(`skills.${idx}.name`)}
                  type="text"
                  placeholder={`e.g. ${['TypeScript', 'React', 'Node.js', 'Python', 'AWS'][idx % 5]}`}
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    errors.skills?.[idx]?.name ? 'border-red-400' : 'border-gray-300'
                  }`}
                />
                {errors.skills?.[idx]?.name && (
                  <p className="text-red-500 text-xs mt-1">{errors.skills[idx]?.name?.message}</p>
                )}
              </div>
              {fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="mt-2 text-red-400 hover:text-red-600 text-sm leading-none"
                  aria-label="Remove skill"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => append({ name: '' })}
          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + Add Skill
        </button>

        <div className="flex justify-between pt-4">
          <button
            type="button"
            onClick={() => {
              setCurrentStep(3)
              router.push('/projects')
            }}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            ← Back
          </button>
          <button
            type="submit"
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Next: Resume Upload →
          </button>
        </div>
      </form>
    </div>
  )
}
