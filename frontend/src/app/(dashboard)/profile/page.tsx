'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getProfile, updateProfile } from '@/lib/profile-api'
import { PersonalInfoTab } from './tabs/PersonalInfoTab'
import { ExperienceTab } from './tabs/ExperienceTab'
import { EducationTab } from './tabs/EducationTab'
import { ProjectsTab } from './tabs/ProjectsTab'
import { SkillsTab } from './tabs/SkillsTab'
import { CertificationsTab } from './tabs/CertificationsTab'
import { PreferencesTab } from './tabs/PreferencesTab'

const TABS = [
  { id: 'personal', label: 'Personal Info' },
  { id: 'experience', label: 'Experience' },
  { id: 'education', label: 'Education' },
  { id: 'projects', label: 'Projects' },
  { id: 'skills', label: 'Skills' },
  { id: 'certifications', label: 'Certifications' },
  { id: 'preferences', label: 'Preferences' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<TabId>('personal')
  const queryClient = useQueryClient()

  const {
    data: profile,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['profile'],
    queryFn: getProfile,
    retry: 1,
  })

  const mutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-400 text-sm">Loading profile…</div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-red-500 text-sm">Failed to load profile. Please try again.</div>
      </div>
    )
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-gray-500 text-sm mt-1">
          Manage your profile information used for job applications.
        </p>
        {profile?.profileCompleteness !== undefined && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 max-w-xs bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${profile.profileCompleteness}%` }}
              />
            </div>
            <span className="text-sm text-gray-600 font-medium">
              {profile.profileCompleteness}% complete
            </span>
          </div>
        )}
      </div>

      {/* Tab navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Profile sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 py-3 px-4 text-sm font-medium border-b-2 transition-colors focus:outline-none ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
              aria-selected={activeTab === tab.id}
              role="tab"
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab panels */}
      <div role="tabpanel">
        {activeTab === 'personal' && (
          <PersonalInfoTab profile={profile} mutation={mutation} />
        )}
        {activeTab === 'experience' && (
          <ExperienceTab profile={profile} mutation={mutation} />
        )}
        {activeTab === 'education' && (
          <EducationTab profile={profile} mutation={mutation} />
        )}
        {activeTab === 'projects' && (
          <ProjectsTab profile={profile} mutation={mutation} />
        )}
        {activeTab === 'skills' && (
          <SkillsTab profile={profile} mutation={mutation} />
        )}
        {activeTab === 'certifications' && (
          <CertificationsTab profile={profile} mutation={mutation} />
        )}
        {activeTab === 'preferences' && (
          <PreferencesTab profile={profile} mutation={mutation} />
        )}
      </div>
    </div>
  )
}
