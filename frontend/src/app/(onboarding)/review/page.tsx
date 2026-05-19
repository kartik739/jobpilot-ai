'use client'

import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useOnboardingStore } from '@/store/onboarding'
import { createProfile, monthToIso, ProfilePayload } from '@/lib/profile-api'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-base font-semibold text-gray-800 border-b border-gray-100 pb-1 mb-3">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex gap-2 text-sm mb-1">
      <span className="text-gray-500 min-w-[150px] flex-shrink-0">{label}:</span>
      <span className="text-gray-800 font-medium">{String(value)}</span>
    </div>
  )
}

export default function ReviewPage() {
  const router = useRouter()
  const store = useOnboardingStore()
  const {
    personalInfo,
    workExperiences,
    educations,
    projects,
    skills,
    resumeUpload,
    preferences,
    sourceConfig,
    setCurrentStep,
    resetOnboarding,
  } = store

  const { mutate, isPending, isError, error } = useMutation({
    mutationFn: (payload: ProfilePayload) => createProfile(payload),
    onSuccess: () => {
      resetOnboarding()
      router.push('/')
    },
  })

  const handleSubmit = () => {
    const payload: ProfilePayload = {
      fullName: personalInfo.fullName,
      email: personalInfo.email,
      phone: personalInfo.phone || undefined,
      location: personalInfo.location,
      linkedinUrl: personalInfo.linkedinUrl || undefined,
      githubUrl: personalInfo.githubUrl || undefined,
      portfolioUrl: personalInfo.portfolioUrl || undefined,
      websiteUrl: personalInfo.websiteUrl || undefined,
      workAuthorization: ['citizen'],   // default; could be expanded
      requiresSponsorship: false,
      noticePeriod: 0,
      remotePreference: preferences.remotePreference,
      targetRoles: preferences.targetRoles,
      preferredLocations: preferences.preferredLocations,
      employmentTypes: preferences.employmentTypes,
      dailyApplyLimit: preferences.dailyApplyLimit,
      coverLetterReviewMode: preferences.coverLetterReviewMode,
      workExperiences: workExperiences.map((w) => ({
        company: w.company,
        title: w.title,
        startDate: monthToIso(w.startDate),
        endDate: w.endDate ? monthToIso(w.endDate) : undefined,
        isCurrent: w.current,
        description: w.description || undefined,
      })),
      educations: educations.map((e) => ({
        institution: e.institution,
        degree: e.degree,
        field: e.field || undefined,
        startDate: monthToIso(e.startDate),
        endDate: e.endDate ? monthToIso(e.endDate) : undefined,
      })),
      projects: projects.map((p) => ({
        name: p.name,
        description: p.description || undefined,
        url: p.url || undefined,
        skills: p.technologies,
      })),
      skills: skills.map((s) => ({ name: s.name })),
    }
    mutate(payload)
  }

  const enabledSources = Object.entries(sourceConfig)
    .filter(([, v]) => v)
    .map(([k]) => k.replace('Enabled', ''))

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Review Your Profile</h2>
      <p className="text-gray-500 mb-6">
        Review everything before submitting. Go back to any step to make changes.
      </p>

      {isError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <strong>Submission failed:</strong>{' '}
          {error instanceof Error ? error.message : 'An unexpected error occurred.'}
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {/* Personal Info */}
        <Section title="Personal Information">
          <Field label="Full Name" value={personalInfo.fullName} />
          <Field label="Email" value={personalInfo.email} />
          <Field label="Phone" value={personalInfo.phone} />
          <Field label="Location" value={personalInfo.location} />
          <Field label="LinkedIn" value={personalInfo.linkedinUrl} />
          <Field label="GitHub" value={personalInfo.githubUrl} />
          <Field label="Portfolio" value={personalInfo.portfolioUrl} />
          <Field label="Website" value={personalInfo.websiteUrl} />
        </Section>

        {/* Work Experience */}
        <Section title={`Work Experience (${workExperiences.length})`}>
          {workExperiences.length === 0 ? (
            <p className="text-sm text-gray-400 italic">None added</p>
          ) : (
            workExperiences.map((w, i) => (
              <div key={i} className="mb-3 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-semibold text-gray-800">
                  {w.title} @ {w.company}
                </p>
                <p className="text-xs text-gray-500">
                  {w.startDate} — {w.current ? 'Present' : (w.endDate ?? 'N/A')}
                </p>
                {w.description && (
                  <p className="text-xs text-gray-600 mt-1">{w.description}</p>
                )}
              </div>
            ))
          )}
        </Section>

        {/* Education */}
        <Section title={`Education (${educations.length})`}>
          {educations.length === 0 ? (
            <p className="text-sm text-gray-400 italic">None added</p>
          ) : (
            educations.map((e, i) => (
              <div key={i} className="mb-2 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-semibold text-gray-800">
                  {e.degree}{e.field ? ` in ${e.field}` : ''} — {e.institution}
                </p>
                <p className="text-xs text-gray-500">
                  {e.startDate ?? ''} — {e.endDate ?? 'N/A'}
                </p>
              </div>
            ))
          )}
        </Section>

        {/* Projects */}
        <Section title={`Projects (${projects.length})`}>
          {projects.length === 0 ? (
            <p className="text-sm text-gray-400 italic">None added</p>
          ) : (
            projects.map((p, i) => (
              <div key={i} className="mb-2 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-semibold text-gray-800">{p.name}</p>
                {p.technologies.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Tech: {p.technologies.join(', ')}
                  </p>
                )}
              </div>
            ))
          )}
        </Section>

        {/* Skills */}
        <Section title={`Skills (${skills.length})`}>
          {skills.length === 0 ? (
            <p className="text-sm text-gray-400 italic">None added</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {skills.map((s, i) => (
                <span
                  key={i}
                  className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
                >
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* Resume */}
        <Section title="Resume">
          {resumeUpload ? (
            <>
              <Field label="Name" value={resumeUpload.name} />
              <Field label="File" value={resumeUpload.fileName} />
              <Field label="Specialization" value={resumeUpload.specialization} />
            </>
          ) : (
            <p className="text-sm text-gray-400 italic">No resume uploaded</p>
          )}
        </Section>

        {/* Preferences */}
        <Section title="Job Preferences">
          <Field label="Target Roles" value={preferences.targetRoles.join(', ')} />
          <Field label="Locations" value={preferences.preferredLocations.join(', ')} />
          <Field label="Remote" value={preferences.remotePreference} />
          <Field label="Daily Apply Limit" value={preferences.dailyApplyLimit} />
          <Field label="Cover Letter Mode" value={preferences.coverLetterReviewMode} />
        </Section>

        {/* Source Config */}
        <Section title="Enabled Job Sources">
          {enabledSources.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No sources enabled</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {enabledSources.map((s) => (
                <span key={s} className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                  {s}
                </span>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="flex justify-between pt-6 border-t border-gray-100 mt-6">
        <button
          type="button"
          onClick={() => {
            setCurrentStep(7)
            router.push('/source-config')
          }}
          className="px-6 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="px-8 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Submitting...' : '✓ Submit Profile'}
        </button>
      </div>
    </div>
  )
}
