// [Freelancer_Service] 로그인 관련 수정본
import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'
import { useAuthStore } from '@/stores/auth-store'

// export const baseUrl = 'http://localhost:8080/api'
// export const baseUrl = 'https://job.estsw.co.kr/api'
export const baseUrl = '/api'

interface CustomRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
}

const apiInstance = axios.create({
  baseURL: baseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
  paramsSerializer: {
    indexes: null,
  },
})

apiInstance.interceptors.request.use(
  (config) => {
    const accessToken = useAuthStore.getState().auth.accessToken
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

interface FailedRequest {
  resolve: (token: string | null) => void
  reject: (error: unknown) => void
}

let isRefreshing = false
let failedQueue: FailedRequest[] = []

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error)
    else prom.resolve(token)
  })
  failedQueue = []
}

apiInstance.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as CustomRequestConfig
    const { auth } = useAuthStore.getState()

    if (
      !originalRequest ||
      originalRequest.url === '/admin/refresh-token' ||
      error.response?.status !== 401 ||
      originalRequest._retry
    ) {
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      })
        .then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          return apiInstance(originalRequest)
        })
        .catch((err) => Promise.reject(err))
    }

    originalRequest._retry = true
    isRefreshing = true

    try {
      const storedRefreshToken = localStorage.getItem('refreshToken')

      if (!storedRefreshToken) {
        throw new Error('No refresh token available')
      }

      const response = await axios.post(
        `${baseUrl}/admin/refresh-token`,
        { refreshToken: storedRefreshToken },
        { headers: { 'Content-Type': 'application/json' } }
      )

      // eslint-disable-next-line no-console
      console.log('재발급 응답 성공:', response.data.output)

      // ✅ [중요 수정] 백엔드 AdminAuthController.refreshToken은 output에 TokenDTO를 바로 담습니다.
      // 따라서 response.data.output.token 이 아니라 response.data.output 에서 바로 꺼내야 합니다.
      const data = response.data.output

      // 혹시 모를 구조 차이에 대비해 안전하게 추출합니다.
      const accessToken = data.token ? data.token.accessToken : data.accessToken
      const refreshToken = data.token
        ? data.token.refreshToken
        : data.refreshToken

      if (!accessToken) {
        throw new Error('새로운 액세스 토큰이 응답에 없습니다.')
      }

      // 2. 스토어 및 로컬스토리지 업데이트
      auth.setAccessToken(accessToken)
      localStorage.setItem('refreshToken', refreshToken)

      // 3. 대기 중이던 요청들에게 새 토큰 전달
      processQueue(null, accessToken)

      // 4. 현재 실패했던 원래 요청 재시도
      originalRequest.headers.Authorization = `Bearer ${accessToken}`
      return apiInstance(originalRequest)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('토큰 재발급 과정 실패:', err)

      processQueue(err, null)

      // 재발급 실패 시 상태 초기화 및 이동
      auth.reset()
      localStorage.removeItem('refreshToken')
      window.location.href = '/sign-in'

      return Promise.reject(err)
    } finally {
      isRefreshing = false
    }
  }
)

export const api = {
  async $get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    const response = await apiInstance.get(url, { params })
    return response.data
  },
  async $post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await apiInstance.post(url, data, config)
    return response.data
  },
  async $put<T>(url: string, data?: unknown): Promise<T> {
    const response = await apiInstance.put(url, data)
    return response.data
  },
  async $patch<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await apiInstance.patch(url, data, config)
    return response.data
  },
  async $delete<T>(url: string): Promise<T> {
    const response = await apiInstance.delete(url)
    return response.data
  },
}
