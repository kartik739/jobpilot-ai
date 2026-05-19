'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useOnboardingStore } from '@/store/onboarding'

const schema = z.object({
  linkedinEnabled: z.boolean(),
  twitterXEnabled: z.boolean(),
  greenhouseEnabled: z.boolean(),
  leverEnabled: z.boolean(),
  ashbyEnabled: z.boolean(),
  workdayEnabled: z.boolean(),
  indeedEnabled: z.boolean(),
  remoteOkEnabled: z.boolean(),
  wellfoundEnabled: z.boolean(),
})

type FormValues = z.infer<typeof schema>

const SOURCES: { key: keyof FormValues; label: string; description: string }[] = [
  { key: 'linkedinEnabled', label: 'LinkedIn', description: 'Playwright-based LinkedIn job scraping' },
  { key: 'twitterXEnabled', label: 'X / Twitter', description: 'Scrape ATS links from tweets' },
  { key: 'greenhouseEnabled', label: 'Greenhouse', description: 'Greenhouse public jobs API' },
  { key: 'leverEnabled', label: 'Lever', description: 'Lever public jobs API' },
  { key: 'ashbyEnabled', label: 'Ashby', description: 'Ashby HQ public jobs API' },
  { key: 'workdayEnabled', label: 'Workday', description: 'Workday jobs RSS / API' },
  { key: 'indeedEnabled', label: 'Indeed', description: 'Indeed jobs API / RSS' },
  { key: 'remoteOkEnabled', label: 'RemoteOK', description: 'RemoteOK public API' },
  { key: 'wellfoundEnabled', label: 'Wellfound', description: 'Wellfound (AngelList) API' },
]

export default function SourceConfigPage() {
  const router = useRouter()
  const { sourceConfig, setSourceConfig, setCurrentStep } = useOnboardingStore()

  const { register, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: sourceConfig,
  })

  const onSubmit = (data: FormValues) => {
    setSourceConfig(data)
    setCurrentStep(8)
    router.push('/review')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Job Source Configuration</h2>
      <p className="text-gray-500 mb-6">
        Choose which job sources to enable. This step is optional — you can skip and configure later.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">
        {SOURCES.map(({ key, label, description }) => (
          <label
            key={key}
            className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
          >
            <div>
              <p className="text-sm font-medium text-gray-800">{label}</p>
              <p className="text-xs text-gray-500">{description}</p>
            </div>
            <div className="relative inline-flex items-center">
              <input
                {...register(key)}
                type="checkbox"
                className="sr-only peer"
                id={`toggle-${key}`}
              />
              <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-2 peer-focus:ring-blue-300 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
            </div>
          </label>
        ))}

        <div className="flex justify-between pt-4">
          <button
            type="button"
            onClick={() => {
              setCurrentStep(6)
              router.push('/preferences')
            }}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            ← Back
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setCurrentStep(8)
                router.push('/review')
              }}
              className="px-6 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Skip
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            >
              Next: Review →
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
