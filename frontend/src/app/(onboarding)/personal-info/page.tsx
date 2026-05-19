'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useOnboardingStore } from '@/store/onboarding'

const schema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(200),
  email: z.string().min(1, 'Email is required').email('Must be a valid email').max(254),
  phone: z.string().optional(),
  location: z.string().min(1, 'Location is required'),
  linkedinUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  githubUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  portfolioUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  websiteUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
})

type FormValues = z.infer<typeof schema>

export default function PersonalInfoPage() {
  const router = useRouter()
  const { personalInfo, setPersonalInfo, setCurrentStep } = useOnboardingStore()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: personalInfo.fullName ?? '',
      email: personalInfo.email ?? '',
      phone: personalInfo.phone ?? '',
      location: personalInfo.location ?? '',
      linkedinUrl: personalInfo.linkedinUrl ?? '',
      githubUrl: personalInfo.githubUrl ?? '',
      portfolioUrl: personalInfo.portfolioUrl ?? '',
      websiteUrl: personalInfo.websiteUrl ?? '',
    },
  })

  const onSubmit = (data: FormValues) => {
    setPersonalInfo(data)
    setCurrentStep(1)
    router.push('/work-experience')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Personal Information</h2>
      <p className="text-gray-500 mb-6">Tell us about yourself so we can personalize your profile.</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              {...register('fullName')}
              type="text"
              placeholder="Jane Doe"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.fullName ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.fullName && (
              <p className="text-red-500 text-xs mt-1">{errors.fullName.message}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              {...register('email')}
              type="email"
              placeholder="jane@example.com"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.email ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.email && (
              <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              {...register('phone')}
              type="tel"
              placeholder="+1 (555) 000-0000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Location <span className="text-red-500">*</span>
            </label>
            <input
              {...register('location')}
              type="text"
              placeholder="San Francisco, CA"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.location ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.location && (
              <p className="text-red-500 text-xs mt-1">{errors.location.message}</p>
            )}
          </div>
        </div>

        <hr className="border-gray-100" />
        <p className="text-sm font-medium text-gray-600">Optional Links</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">LinkedIn URL</label>
            <input
              {...register('linkedinUrl')}
              type="url"
              placeholder="https://linkedin.com/in/..."
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.linkedinUrl ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.linkedinUrl && (
              <p className="text-red-500 text-xs mt-1">{errors.linkedinUrl.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GitHub URL</label>
            <input
              {...register('githubUrl')}
              type="url"
              placeholder="https://github.com/..."
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.githubUrl ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.githubUrl && (
              <p className="text-red-500 text-xs mt-1">{errors.githubUrl.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Portfolio URL</label>
            <input
              {...register('portfolioUrl')}
              type="url"
              placeholder="https://yourportfolio.com"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.portfolioUrl ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.portfolioUrl && (
              <p className="text-red-500 text-xs mt-1">{errors.portfolioUrl.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website URL</label>
            <input
              {...register('websiteUrl')}
              type="url"
              placeholder="https://yoursite.com"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.websiteUrl ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {errors.websiteUrl && (
              <p className="text-red-500 text-xs mt-1">{errors.websiteUrl.message}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Next: Work Experience →
          </button>
        </div>
      </form>
    </div>
  )
}
