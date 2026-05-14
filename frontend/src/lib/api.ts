import axios from 'axios'
import { useAuthStore } from '@/store/auth'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
})

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// On 401, try refreshing once; on failure clear auth and redirect
let isRefreshing = false
let refreshSubscribers: Array<(token: string) => void> = []

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb)
}

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token))
  refreshSubscribers = []
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise((resolve) => {
        subscribeTokenRefresh((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          resolve(api(originalRequest))
        })
      })
    }

    originalRequest._retry = true
    isRefreshing = true

    const { refreshToken, setTokens, clearAuth } = useAuthStore.getState()

    try {
      const { data } = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/auth/refresh`,
        { refreshToken }
      )
      const { accessToken: newAccess, refreshToken: newRefresh } = data
      setTokens(newAccess, newRefresh)
      onTokenRefreshed(newAccess)
      originalRequest.headers.Authorization = `Bearer ${newAccess}`
      return api(originalRequest)
    } catch {
      clearAuth()
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
      return Promise.reject(error)
    } finally {
      isRefreshing = false
    }
  }
)

export default api
