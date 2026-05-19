import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkExperience {
  company: string
  title: string
  startDate: string
  endDate?: string
  current: boolean
  description?: string
}

export interface Education {
  institution: string
  degree: string
  field?: string
  startDate?: string
  endDate?: string
}

export interface Project {
  name: string
  description?: string
  url?: string
  technologies: string[]
}

export interface Skill {
  name: string
}

export interface ResumeUpload {
  fileName: string
  fileBase64: string
  specialization: 'backend' | 'frontend' | 'fullstack' | 'devops' | 'cloud' | 'ai_ml' | 'mobile' | 'data' | 'general'
  name: string
}

export interface Preferences {
  targetRoles: string[]
  preferredLocations: string[]
  remotePreference: 'remote_only' | 'hybrid' | 'onsite' | 'flexible'
  employmentTypes: string[]
  dailyApplyLimit: number
  coverLetterReviewMode: 'auto' | 'review_first'
}

export interface SourceConfig {
  linkedinEnabled: boolean
  twitterXEnabled: boolean
  greenhouseEnabled: boolean
  leverEnabled: boolean
  ashbyEnabled: boolean
  workdayEnabled: boolean
  indeedEnabled: boolean
  remoteOkEnabled: boolean
  wellfoundEnabled: boolean
}

export interface PersonalInfo {
  fullName: string
  email: string
  phone?: string
  location: string
  linkedinUrl?: string
  githubUrl?: string
  portfolioUrl?: string
  websiteUrl?: string
}

// ── Store state ───────────────────────────────────────────────────────────────

export interface OnboardingState {
  currentStep: number
  personalInfo: PersonalInfo
  workExperiences: WorkExperience[]
  educations: Education[]
  projects: Project[]
  skills: Skill[]
  resumeUpload: ResumeUpload | null
  preferences: Preferences
  sourceConfig: SourceConfig

  setCurrentStep: (step: number) => void
  setPersonalInfo: (data: PersonalInfo) => void
  setWorkExperiences: (data: WorkExperience[]) => void
  setEducations: (data: Education[]) => void
  setProjects: (data: Project[]) => void
  setSkills: (data: Skill[]) => void
  setResumeUpload: (data: ResumeUpload | null) => void
  setPreferences: (data: Preferences) => void
  setSourceConfig: (data: SourceConfig) => void
  resetOnboarding: () => void
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const defaultPreferences: Preferences = {
  targetRoles: [],
  preferredLocations: [],
  remotePreference: 'flexible',
  employmentTypes: [],
  dailyApplyLimit: 10,
  coverLetterReviewMode: 'auto',
}

const defaultSourceConfig: SourceConfig = {
  linkedinEnabled: true,
  twitterXEnabled: false,
  greenhouseEnabled: true,
  leverEnabled: true,
  ashbyEnabled: true,
  workdayEnabled: true,
  indeedEnabled: true,
  remoteOkEnabled: true,
  wellfoundEnabled: true,
}

const defaultPersonalInfo: PersonalInfo = {
  fullName: '',
  email: '',
  phone: '',
  location: '',
  linkedinUrl: '',
  githubUrl: '',
  portfolioUrl: '',
  websiteUrl: '',
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      currentStep: 0,
      personalInfo: defaultPersonalInfo,
      workExperiences: [],
      educations: [],
      projects: [],
      skills: [],
      resumeUpload: null,
      preferences: defaultPreferences,
      sourceConfig: defaultSourceConfig,

      setCurrentStep: (step) => set({ currentStep: step }),
      setPersonalInfo: (data) => set({ personalInfo: data }),
      setWorkExperiences: (data) => set({ workExperiences: data }),
      setEducations: (data) => set({ educations: data }),
      setProjects: (data) => set({ projects: data }),
      setSkills: (data) => set({ skills: data }),
      setResumeUpload: (data) => set({ resumeUpload: data }),
      setPreferences: (data) => set({ preferences: data }),
      setSourceConfig: (data) => set({ sourceConfig: data }),
      resetOnboarding: () =>
        set({
          currentStep: 0,
          personalInfo: defaultPersonalInfo,
          workExperiences: [],
          educations: [],
          projects: [],
          skills: [],
          resumeUpload: null,
          preferences: defaultPreferences,
          sourceConfig: defaultSourceConfig,
        }),
    }),
    { name: 'onboarding-storage' }
  )
)
