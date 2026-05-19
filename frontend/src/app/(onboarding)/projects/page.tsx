'use client'

import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useOnboardingStore } from '@/store/onboarding'

const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  technologies: z.array(z.string()),
})

const schema = z.object({
  projects: z.array(projectSchema),
})

type FormValues = z.infer<typeof schema>

function TechTagInput({
  value,
  onChange,
}: {
  value: string[]
  onChange: (v: string[]) => void
}) {
  const [input, setInput] = useState('')

  const addTag = () => {
    const tag = input.trim()
    if (tag && !value.includes(tag)) {
      onChange([...value, tag])
    }
    setInput('')
  }

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  return (
    <div>
      <div className="flex gap-2 mb-2 flex-wrap">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-blue-500 hover:text-blue-700 font-bold leading-none"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTag()
            }
          }}
          placeholder="e.g. React, TypeScript (press Enter)"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={addTag}
          className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-sm hover:bg-gray-200 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  )
}

export default function ProjectsPage() {
  const router = useRouter()
  const { projects, setProjects, setCurrentStep } = useOnboardingStore()

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      projects:
        projects.length > 0
          ? projects
          : [],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'projects' })

  const onSubmit = (data: FormValues) => {
    setProjects(data.projects)
    setCurrentStep(4)
    router.push('/skills')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Projects</h2>
      <p className="text-gray-500 mb-2">
        Showcase your personal or open-source projects. This step is optional — you can skip it.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        {fields.length === 0 && (
          <div className="py-8 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
            No projects added yet. Add one below or skip this step.
          </div>
        )}

        {fields.map((field, idx) => {
          const projErrors = errors.projects?.[idx]

          return (
            <div key={field.id} className="border border-gray-200 rounded-lg p-5 bg-gray-50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">Project #{idx + 1}</h3>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-red-500 hover:text-red-700 text-xs font-medium"
                >
                  Remove
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Project Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      {...register(`projects.${idx}.name`)}
                      type="text"
                      placeholder="My Awesome Project"
                      className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        projErrors?.name ? 'border-red-400' : 'border-gray-300'
                      }`}
                    />
                    {projErrors?.name && (
                      <p className="text-red-500 text-xs mt-1">{projErrors.name.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
                    <input
                      {...register(`projects.${idx}.url`)}
                      type="url"
                      placeholder="https://github.com/..."
                      className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        projErrors?.url ? 'border-red-400' : 'border-gray-300'
                      }`}
                    />
                    {projErrors?.url && (
                      <p className="text-red-500 text-xs mt-1">{projErrors.url.message}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    {...register(`projects.${idx}.description`)}
                    rows={2}
                    placeholder="What does this project do?"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Technologies
                  </label>
                  <Controller
                    name={`projects.${idx}.technologies`}
                    control={control}
                    render={({ field }) => (
                      <TechTagInput value={field.value} onChange={field.onChange} />
                    )}
                  />
                </div>
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() => append({ name: '', description: '', url: '', technologies: [] })}
          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + Add Project
        </button>

        <div className="flex justify-between pt-4">
          <button
            type="button"
            onClick={() => {
              setCurrentStep(2)
              router.push('/education')
            }}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            ← Back
          </button>
          <button
            type="submit"
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Next: Skills →
          </button>
        </div>
      </form>
    </div>
  )
}
