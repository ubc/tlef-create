// API Service Layer for TLEF-CREATE Backend Integration
import { API_URL } from '../config/api';

const API_BASE = API_URL;

// Types for API responses
export interface ApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    timestamp: string;
  };
}

export interface Folder {
  _id: string;
  name: string;
  instructor: string;
  materials: string[];
  quizzes: string[];
  stats: {
    totalQuizzes: number;
    totalQuestions: number;
    totalMaterials: number;
    lastActivity: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Material {
  _id: string;
  name: string;
  type: 'pdf' | 'docx' | 'url' | 'text';
  originalFileName?: string;
  filePath?: string;
  url?: string;
  content?: string;
  fileSize?: number;
  checksum?: string;
  folder: string;
  uploadedBy: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processingError?: {
    message: string;
    timestamp: string;
  };
  qdrantDocumentId?: string;
  timesUsedInQuiz: number;
  lastUsed?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Quiz {
  _id: string;
  name: string;
  folder: string;
  materials: string[] | Material[];
  learningObjectives: string[];
  questions: string[];
  generationPlans: string[];
  activePlan?: string;
  settings: {
    pedagogicalApproach: 'support' | 'assess' | 'gamify' | 'custom';
    questionsPerObjective: number;
    questionTypes: Array<{
      type: string;
      count: number;
      scope?: 'per-lo' | 'whole-quiz';
      percentage?: number;
    }>;
    totalPerLO?: number;
    totalWholeQuiz?: number;
    difficulty: 'easy' | 'moderate' | 'hard';
    // NEW: Plan-based system
    planMode?: 'manual' | 'ai-auto';
    planItems?: Array<{
      type: string;
      learningObjective: string;
      count: number;
    }>;
    aiConfig?: {
      totalQuestions: number;
      approach: 'support' | 'assess' | 'gamify';
      additionalInstructions?: string;
    };
  };
  status: 'draft' | 'materials-assigned' | 'objectives-set' | 'plan-generated' | 'plan-approved' | 'generating' | 'generated' | 'reviewing' | 'completed';
  progress: {
    materialsAssigned: boolean;
    objectivesSet: boolean;
    planGenerated: boolean;
    planApproved: boolean;
    questionsGenerated: boolean;
    reviewCompleted: boolean;
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface LearningObjective {
  _id: string;
  text: string;
  quiz: string;
  order: number;
  generatedFrom: string[];
  generationMetadata: {
    isAIGenerated: boolean;
    llmModel?: string;
    generationPrompt?: string;
    confidence?: number;
    processingTime?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface GenerationPlan {
  _id: string;
  quiz: string;
  approach: 'support' | 'assess' | 'gamify' | 'custom';
  questionsPerLO: number;
  totalQuestions: number;
  customFormula?: {
    questionTypes: Array<{
      type: string;
      count: number;
      percentage: number;
      scope: 'per-lo' | 'whole-quiz';
      editMode: 'count' | 'percentage';
    }>;
    totalPerLO: number;
    totalWholeQuiz: number;
    totalQuestions: number;
  };
  breakdown: Array<{
    learningObjective: string | LearningObjective;
    questionTypes: Array<{
      type: string;
      count: number;
      reasoning: string;
    }>;
  }>;
  distribution: Array<{
    type: string;
    totalCount: number;
    percentage: number;
  }>;
  status: 'draft' | 'approved' | 'modified' | 'used';
  generationMetadata?: {
    llmModel: string;
    generationPrompt: string;
    processingTime: number;
    confidence: number;
    reasoning: string;
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// Base API client with error handling
class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const config: RequestInit = {
      credentials: 'include', // Include session cookies for SAML auth
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, config);
      
      // Handle different response types
      const contentType = response.headers.get('content-type');
      let data;
      
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        // Backend returns structured error responses
        if (data && typeof data === 'object' && data.error) {
          throw new ApiError(data.error.message, response.status, data.error.code, data.error.details);
        } else {
          throw new ApiError(`HTTP ${response.status}: ${response.statusText}`, response.status);
        }
      }

      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      
      // Network or other errors
      console.error('API Request failed:', error);
      throw new ApiError('Network error or server unavailable', 0);
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  async getBlob(endpoint: string): Promise<Blob> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const config: RequestInit = {
      credentials: 'include',
      method: 'GET',
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        // Try to get error message if available
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const data = await response.json();
          if (data && data.error) {
            throw new ApiError(data.error.message, response.status, data.error.code, data.error.details);
          }
        }
        throw new ApiError(`HTTP ${response.status}: ${response.statusText}`, response.status);
      }

      return await response.blob();
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      console.error('Blob download failed:', error);
      throw new ApiError('Failed to download file', 0);
    }
  }

  // For file uploads (multipart/form-data) with progress tracking
  async upload<T>(
    endpoint: string,
    formData: FormData,
    onProgress?: (progress: number) => void
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          onProgress(percentComplete);
        }
      });

      // Handle completion
      xhr.addEventListener('load', () => {
        try {
          const contentType = xhr.getResponseHeader('content-type');
          let data: unknown;

          if (contentType?.includes('application/json')) {
            data = JSON.parse(xhr.responseText) as unknown;
          } else {
            data = xhr.responseText;
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data as T);
          } else {
            // Handle error responses
            const errorData = data as Record<string, Record<string, unknown>>;
            if (data && typeof data === 'object' && (data as Record<string, unknown>).error) {
              const err = (data as Record<string, Record<string, unknown>>).error;
              reject(new ApiError(err.message as string, xhr.status, err.code as string, err.details as Record<string, unknown>));
            } else if (data && typeof data === 'object' && errorData.data && Array.isArray(errorData.data.errors) && (errorData.data.errors as unknown[]).length > 0) {
              const firstError = (errorData.data.errors as Record<string, unknown>[])[0];
              const errorMessage = (firstError.error as string) || 'File upload failed';
              reject(new ApiError(`Upload failed: ${errorMessage}`, xhr.status, 'FILE_UPLOAD_ERROR', errorData.data.errors as unknown as Record<string, unknown>));
            } else {
              reject(new ApiError(`HTTP ${xhr.status}: ${xhr.statusText}`, xhr.status));
            }
          }
        } catch (error) {
          console.error('❌ Error parsing upload response:', error);
          reject(new ApiError('Failed to parse server response', xhr.status));
        }
      });

      // Handle network errors
      xhr.addEventListener('error', () => {
        console.error('❌ Network error during upload');
        reject(new ApiError('Network error or server unavailable', 0));
      });

      // Handle timeout
      xhr.addEventListener('timeout', () => {
        console.error('❌ Upload timeout');
        reject(new ApiError('Upload request timed out', 0));
      });

      // Handle abort
      xhr.addEventListener('abort', () => {
        console.error('❌ Upload aborted');
        reject(new ApiError('Upload was aborted', 0));
      });

      // Open connection and send
      xhr.open('POST', url, true);
      xhr.withCredentials = true; // Include cookies for SAML auth
      xhr.timeout = 5 * 60 * 1000; // 5 minute timeout for large files
      xhr.send(formData);
    });
  }
}

// Custom error class for API errors
export class ApiError extends Error {
  public status: number;
  public code?: string;
  public details?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  // Check if error is due to authentication issues
  isAuthError(): boolean {
    return this.status === 401 || this.code === 'AUTH_ERROR';
  }

  // Check if error is due to validation issues
  isValidationError(): boolean {
    return this.status === 400 || this.code === 'VALIDATION_ERROR';
  }

  // Check if error is due to not found
  isNotFoundError(): boolean {
    return this.status === 404 || this.code === 'NOT_FOUND';
  }
}

// Create API client instance
const apiClient = new ApiClient(`${API_BASE}/api/create`);

// Folders API
export const foldersApi = {
  // GET /api/create/folders - Get user's folders
  getFolders: async (): Promise<{ folders: Folder[] }> => {
    const response = await apiClient.get<{ success: boolean; data: { folders: Folder[] }; message: string }>('/folders');
    return response.data; // Extract the data object which contains { folders: [...] }
  },

  // POST /api/create/folders - Create new folder with quizzes
  createFolder: async (name: string, quizCount: number = 1): Promise<{ folder: Folder }> => {
    const response = await apiClient.post<{ success: boolean; data: { folder: Folder }; message: string }>('/folders', { name, quizCount });
    return response.data; // Extract the data object which contains { folder: {...} }
  },

  // GET /api/create/folders/:id - Get specific folder
  getFolder: async (id: string): Promise<{ folder: Folder }> => {
    const response = await apiClient.get<{ success: boolean; data: { folder: Folder }; message: string }>(`/folders/${id}`);
    return response.data;
  },

  // PUT /api/create/folders/:id - Update folder name
  updateFolder: async (id: string, name: string): Promise<{ folder: Folder }> => {
    const response = await apiClient.put<{ success: boolean; data: { folder: Folder }; message: string }>(`/folders/${id}`, { name });
    return response.data;
  },

  // DELETE /api/create/folders/:id - Delete folder
  deleteFolder: async (id: string): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ success: boolean; message: string }>(`/folders/${id}`);
    return { message: response.message };
  },
};

// Materials API
export const materialsApi = {
  // POST /api/create/materials/upload - Upload files (PDF, DOCX)
  uploadFiles: async (
    folderId: string,
    files: FileList,
    onProgress?: (progress: number) => void
  ): Promise<{ materials: Material[] }> => {
    const formData = new FormData();
    formData.append('folderId', folderId);

    // Add all files to FormData
    Array.from(files).forEach(file => {
      formData.append('files', file);
    });

    const response = await apiClient.upload<{ success: boolean; data: { materials: Material[] }; message: string }>(
      '/materials/upload',
      formData,
      onProgress
    );
    return response.data;
  },

  // POST /api/create/materials/url - Add URL material
  addUrl: async (folderId: string, url: string, name?: string): Promise<{ material: Material }> => {
    const response = await apiClient.post<{ success: boolean; data: { material: Material }; message: string }>('/materials/url', {
      folderId,
      url,
      name
    });
    return response.data;
  },

  // POST /api/create/materials/text - Add text material
  addText: async (folderId: string, content: string, name: string): Promise<{ material: Material }> => {
    const response = await apiClient.post<{ success: boolean; data: { material: Material }; message: string }>('/materials/text', {
      folderId,
      content,
      name
    });
    return response.data;
  },

  // GET /api/create/materials/folder/:folderId - Get folder's materials
  getMaterials: async (folderId: string): Promise<{ materials: Material[] }> => {
    const response = await apiClient.get<{ success: boolean; data: { materials: Material[] }; message: string }>(`/materials/folder/${folderId}`);
    return response.data;
  },

  // DELETE /api/create/materials/:id - Delete material
  deleteMaterial: async (id: string): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ success: boolean; message: string }>(`/materials/${id}`);
    return { message: response.message };
  },

  // GET /api/create/materials/:id/status - Get processing status
  getProcessingStatus: async (id: string): Promise<{ material: Material }> => {
    const response = await apiClient.get<{ success: boolean; data: { material: Material }; message: string }>(`/materials/${id}/status`);
    return response.data;
  },

  // GET /api/create/materials/allowed-domains - Get allowed URL domains
  getAllowedDomains: async (): Promise<{ domains: string[] | null }> => {
    const response = await apiClient.get<{ success: boolean; data: { domains: string[] | null }; message: string }>('/materials/allowed-domains');
    return response.data;
  },
};

// Quiz API
export const quizApi = {
  // GET /api/create/quizzes/folder/:folderId - Get folder's quizzes
  getQuizzes: async (folderId: string): Promise<{ quizzes: Quiz[] }> => {
    const response = await apiClient.get<{ success: boolean; data: { quizzes: Quiz[] }; message: string }>(`/quizzes/folder/${folderId}`);
    return response.data;
  },

  // POST /api/create/quizzes - Create new quiz
  createQuiz: async (name: string, folderId: string): Promise<{ quiz: Quiz }> => {
    const response = await apiClient.post<{ success: boolean; data: { quiz: Quiz }; message: string }>('/quizzes', { name, folderId });
    return response.data;
  },

  // GET /api/create/quizzes/:id - Get specific quiz
  getQuiz: async (id: string): Promise<{ quiz: Quiz }> => {
    const response = await apiClient.get<{ success: boolean; data: { quiz: Quiz }; message: string }>(`/quizzes/${id}`);
    return response.data;
  },

  // PUT /api/create/quizzes/:id - Update quiz basic info
  updateQuiz: async (id: string, updates: { name?: string; settings?: Partial<Quiz['settings']> }): Promise<{ quiz: Quiz }> => {
    const response = await apiClient.put<{ success: boolean; data: { quiz: Quiz }; message: string }>(`/quizzes/${id}`, updates);
    return response.data;
  },

  // DELETE /api/create/quizzes/:id - Delete quiz
  deleteQuiz: async (id: string): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ success: boolean; message: string }>(`/quizzes/${id}`);
    return { message: response.message };
  },

  // PUT /api/create/quizzes/:id/materials - Assign materials to quiz
  assignMaterials: async (id: string, materialIds: string[]): Promise<{ quiz: Quiz }> => {
    const response = await apiClient.put<{ success: boolean; data: { quiz: Quiz }; message: string }>(`/quizzes/${id}/materials`, { materialIds });
    return response.data;
  },

  // GET /api/create/quizzes/:id/progress - Get quiz progress
  getQuizProgress: async (id: string): Promise<{ progress: Quiz['progress'] }> => {
    const response = await apiClient.get<{ success: boolean; data: { progress: Quiz['progress'] }; message: string }>(`/quizzes/${id}/progress`);
    return response.data;
  },

  // POST /api/create/quizzes/:id/duplicate - Duplicate quiz
  duplicateQuiz: async (id: string, name?: string): Promise<{ quiz: Quiz }> => {
    const response = await apiClient.post<{ success: boolean; data: { quiz: Quiz }; message: string }>(`/quizzes/${id}/duplicate`, { name });
    return response.data;
  },
};

// Learning Objectives API
export const objectivesApi = {
  // GET /api/create/objectives/quiz/:quizId - Get quiz objectives
  getObjectives: async (quizId: string): Promise<{ objectives: LearningObjective[] }> => {
    const response = await apiClient.get<{ success: boolean; data: { objectives: LearningObjective[] }; message: string }>(`/objectives/quiz/${quizId}`);
    return response.data;
  },

  // POST /api/create/objectives/generate - AI generate from materials
  generateObjectives: async (quizId: string, materialIds: string[], targetCount?: number, customPrompt?: string): Promise<{ objectives: LearningObjective[] }> => {
    const response = await apiClient.post<{ success: boolean; data: { objectives: LearningObjective[] }; message: string }>('/objectives/generate', { quizId, materialIds, targetCount, customPrompt });
    return response.data;
  },

  // POST /api/create/objectives/classify - AI classify user text into LOs
  classifyObjectives: async (quizId: string, text: string): Promise<{ objectives: LearningObjective[] }> => {
    const response = await apiClient.post<{ success: boolean; data: { objectives: LearningObjective[] }; message: string }>('/objectives/classify', { quizId, text });
    return response.data;
  },

  // POST /api/create/objectives - Add single LO or save batch
  saveObjectives: async (quizId: string, objectives: { text: string; order: number }[]): Promise<{ objectives: LearningObjective[] }> => {
    // Send as array with quizId included in each objective for batch creation
    const objectivesWithQuizId = objectives.map(obj => ({ ...obj, quizId }));
    const response = await apiClient.post<{ success: boolean; data: { objectives: LearningObjective[] }; message: string }>('/objectives', objectivesWithQuizId);
    return response.data;
  },

  // PUT /api/create/objectives/:id - Update objective
  updateObjective: async (id: string, updates: { text: string }): Promise<{ objective: LearningObjective }> => {
    const response = await apiClient.put<{ success: boolean; data: { objective: LearningObjective }; message: string }>(`/objectives/${id}`, updates);
    return response.data;
  },

  // DELETE /api/create/objectives/:id - Delete objective
  deleteObjective: async (id: string, confirmed: boolean = false): Promise<{ 
    message: string; 
    requiresConfirmation?: boolean; 
    questionCount?: number;
    objectiveId?: string;
  }> => {
    const url = confirmed ? `/objectives/${id}?confirmed=true` : `/objectives/${id}`;
    const response = await apiClient.delete<{ 
      success: boolean; 
      data?: {
        requiresConfirmation?: boolean;
        questionCount?: number;
        objectiveId?: string;
        deletedQuestions?: number;
      };
      message: string;
    }>(url);
    
    return { 
      message: response.message,
      requiresConfirmation: response.data?.requiresConfirmation,
      questionCount: response.data?.questionCount,
      objectiveId: response.data?.objectiveId
    };
  },

  // POST /api/create/objectives/:id/regenerate - Regenerate single objective
  regenerateSingleObjective: async (id: string, customPrompt?: string): Promise<{ objective: LearningObjective }> => {
    const response = await apiClient.post<{ success: boolean; data: { objective: LearningObjective }; message: string }>(`/objectives/${id}/regenerate`, {
      customPrompt
    });
    return response.data;
  },

  // DELETE /api/create/objectives/quiz/:quizId/all - Delete all objectives for a quiz
  deleteAllObjectives: async (quizId: string): Promise<{ deletedCount: number; quizId: string }> => {
    try {
      const response = await apiClient.delete<{ success: boolean; data: { deletedCount: number; quizId: string }; message: string }>(`/objectives/quiz/${quizId}/all`);
      return response.data;
    } catch (error) {
      console.error('API deleteAllObjectives error:', error);
      throw error;
    }
  },
};

// Generation Plan API
export const plansApi = {
  // POST /api/create/plans/generate-ai - Generate AI-powered plan (NEW)
  generateAIPlan: async (
    quizId: string,
    totalQuestions: number,
    approach: 'support' | 'assess' | 'gamify',
    additionalInstructions?: string
  ): Promise<{
    planItems: Array<{
      type: string;
      learningObjectiveIndex: number;
      count: number;
    }>
  }> => {
    const response = await apiClient.post<{
      success: boolean;
      data: {
        planItems: Array<{
          type: string;
          learningObjectiveIndex: number;
          count: number;
        }>
      };
      message: string
    }>('/plans/generate-ai', {
      quizId,
      totalQuestions,
      approach,
      additionalInstructions
    });
    return response.data;
  },

  // POST /api/create/plans/generate - Generate AI plan for quiz (OLD)
  generatePlan: async (quizId: string, approach: 'support' | 'assess' | 'gamify' | 'custom', questionsPerLO: number = 3, customFormula?: GenerationPlan['customFormula']): Promise<{ plan: GenerationPlan }> => {
    const requestData: { quizId: string; approach: string; questionsPerLO: number; customFormula?: GenerationPlan['customFormula'] } = {
      quizId,
      approach,
      questionsPerLO
    };

    // Add custom formula if provided
    if (customFormula) {
      requestData.customFormula = customFormula;
    }

    const response = await apiClient.post<{ success: boolean; data: { plan: GenerationPlan }; message: string }>('/plans/generate', requestData);
    return response.data;
  },

  // GET /api/create/plans/quiz/:quizId - Get plans for quiz
  getPlans: async (quizId: string): Promise<{ plans: GenerationPlan[] }> => {
    const response = await apiClient.get<{ success: boolean; data: { plans: GenerationPlan[] }; message: string }>(`/plans/quiz/${quizId}`);
    return response.data;
  },

  // GET /api/create/plans/:id - Get specific plan details
  getPlan: async (id: string): Promise<{ plan: GenerationPlan }> => {
    const response = await apiClient.get<{ success: boolean; data: { plan: GenerationPlan }; message: string }>(`/plans/${id}`);
    return response.data;
  },

  // PUT /api/create/plans/:id - Modify plan breakdown
  updatePlan: async (id: string, breakdown: GenerationPlan['breakdown']): Promise<{ plan: GenerationPlan }> => {
    const response = await apiClient.put<{ success: boolean; data: { plan: GenerationPlan }; message: string }>(`/plans/${id}`, { breakdown });
    return response.data;
  },

  // POST /api/create/plans/:id/approve - Approve plan (set as active)
  approvePlan: async (id: string): Promise<{ plan: GenerationPlan }> => {
    const response = await apiClient.post<{ success: boolean; data: { plan: GenerationPlan }; message: string }>(`/plans/${id}/approve`, {});
    return response.data;
  },

  // DELETE /api/create/plans/:id - Delete plan
  deletePlan: async (id: string): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ success: boolean; message: string }>(`/plans/${id}`);
    return { message: response.message };
  },
};

// Types for streaming question generation
export interface QuestionConfig {
  questionType: string;
  difficulty: string;
  learningObjectiveIndex?: number;
  learningObjective?: LearningObjective;
  scope?: 'per-lo' | 'whole-quiz';
}

export interface GenerationPlanReference {
  _id: string;
  approach: string;
  breakdown: GenerationPlan['breakdown'];
}

// Question API
export const questionsApi = {
  // GET /api/create/questions/quiz/:quizId - Get quiz questions
  getQuestions: async (quizId: string): Promise<{ questions: Question[] }> => {
    const response = await apiClient.get<{ success: boolean; data: { questions: Question[] }; message: string }>(`/questions/quiz/${quizId}`);
    return response.data; // Extract the data object which contains { questions: [...] }
  },

  // DEPRECATED: Old generation endpoints - Use /streaming/generate-questions instead
  // generateFromPlan: REMOVED - Use streaming generation
  // generateFromPlanStream: REMOVED - Use streaming generation

  // NOTE: All question generation now goes through /api/create/streaming/generate-questions
  // This provides real-time streaming updates and uses the modern LLM service

  // POST /api/create/questions/generate-from-plan-stream (OLD - KEEPING FOR REFERENCE)
  generateFromPlanStream_DEPRECATED: async (
    quizId: string,
    onStream: (event: string, data: Record<string, unknown>) => void,
    onComplete: (data: Record<string, unknown>) => void,
    onError: (error: string) => void
  ): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE}/questions/generate-from-plan-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({ quizId })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
            continue;
          }

          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              // Handle based on event type
              if (currentEvent === 'stream') {
                onStream('stream', data);
              } else if (currentEvent === 'question-created') {
                onStream('question-created', data);
              } else if (currentEvent === 'complete') {
                onComplete(data);
                return;
              } else if (currentEvent === 'status') {
                onStream('status', data);
              } else if (currentEvent === 'error') {
                console.error('❌ Error:', data.message);
                onError(data.message);
                return;
              }

              // Reset event after processing
              currentEvent = '';
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error: unknown) {
      console.error('❌ Streaming error:', error);
      onError(error instanceof Error ? error.message : 'Streaming failed');
    }
  },

  // POST /api/create/streaming/generate-questions - Start streaming question generation
  generateQuestionsStreaming: async (
    quizId: string,
    questionConfigs: QuestionConfig[],
    generationPlan?: GenerationPlanReference
  ): Promise<{ sessionId: string; jobId: string; sseEndpoint: string }> => {
    const response = await apiClient.post<{ 
      success: boolean; 
      sessionId: string; 
      jobId: string; 
      message: string;
      sseEndpoint: string;
    }>('/streaming/generate-questions', { 
      quizId, 
      questionConfigs, 
      generationPlan 
    });
    
    return {
      sessionId: response.sessionId,
      jobId: response.jobId,
      sseEndpoint: response.sseEndpoint
    };
  },

  // POST /api/create/questions - Create manual question
  createQuestion: async (questionData: {
    quizId: string;
    learningObjectiveId: string;
    type: string;
    difficulty: string;
    questionText: string;
    content?: Question['content'];
    correctAnswer: string;
    explanation?: string;
  }): Promise<{ question: Question }> => {
    const response = await apiClient.post<{ success: boolean; data: { question: Question }; message: string }>('/questions', questionData);
    return response.data;
  },

  // PUT /api/create/questions/:id - Update question
  updateQuestion: async (id: string, updates: Partial<Question>): Promise<{ question: Question }> => {
    const response = await apiClient.put<{ success: boolean; data: { question: Question }; message: string }>(`/questions/${id}`, updates);
    return response.data;
  },

  // DELETE /api/create/questions/:id - Delete question
  deleteQuestion: async (id: string): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ success: boolean; message: string }>(`/questions/${id}`);
    return { message: response.message };
  },

  // POST /api/create/questions/:id/regenerate - Regenerate specific question
  regenerateQuestion: async (id: string, customPrompt?: string): Promise<{ question: Question }> => {
    const response = await apiClient.post<{ success: boolean; data: { question: Question }; message: string }>(`/questions/${id}/regenerate`, {
      customPrompt: customPrompt || undefined
    });
    return response.data;
  },

  // PUT /api/create/questions/reorder - Reorder questions
  reorderQuestions: async (quizId: string, questionIds: string[]): Promise<{ questions: Question[] }> => {
    const response = await apiClient.put<{ success: boolean; data: { questions: Question[] }; message: string }>('/questions/reorder', { quizId, questionIds });
    return response.data;
  },

  // DELETE /api/create/questions/quiz/:quizId - Delete all questions for a quiz
  deleteAllQuestions: async (quizId: string): Promise<{ deletedCount: number; quizId: string }> => {
    const response = await apiClient.delete<{ success: boolean; data: { deletedCount: number; quizId: string }; message: string }>(`/questions/quiz/${quizId}`);
    return response.data;
  },
};

// Question interface
export interface Question {
  _id: string;
  quiz: string;
  learningObjective: string | LearningObjective;
  generationPlan?: string;
  type: 'multiple-choice' | 'true-false' | 'flashcard' | 'summary' | 'discussion' | 'matching' | 'ordering' | 'cloze';
  difficulty: 'easy' | 'moderate' | 'hard';
  questionText: string;
  content: {
    options?: Array<{ text: string; isCorrect: boolean; order?: number }>;
    front?: string;
    back?: string;
    leftItems?: string[];
    rightItems?: string[];
    matchingPairs?: string[][];
    items?: string[];
    correctOrder?: string[];
    textWithBlanks?: string;
    blankOptions?: string[][];
    correctAnswers?: string[];
    title?: string;
    additionalNotes?: string;
    keyPoints?: Array<{ title: string; explanation: string }>;
  };
  correctAnswer: string | string[] | boolean;
  explanation?: string;
  order: number;
  reviewStatus: 'pending' | 'approved' | 'needs-review' | 'rejected';
  generationMetadata?: {
    generatedFrom: string[];
    llmModel: string;
    generationPrompt: string;
    confidence: number;
    processingTime: number;
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// Export API
export const exportApi = {
  exportToH5P: async (quizId: string): Promise<ApiResponse<{ exportId: string; filename: string; downloadUrl: string }>> => {
    return await apiClient.post(`/export/h5p/${quizId}`);
  },

  exportToPDF: async (quizId: string, type: 'questions' | 'answers' | 'combined'): Promise<ApiResponse<{ exportId: string; filename: string; downloadUrl: string }>> => {
    return await apiClient.post(`/export/pdf/${quizId}`, { type });
  },

  downloadExport: async (exportId: string): Promise<Blob> => {
    return await apiClient.getBlob(`/export/${exportId}/download`);
  }
};

// Search API
export interface SearchResult {
  type: 'material' | 'question' | 'learning-objective';
  id: string;
  title: string;
  snippet: string;
  courseName: string;
  courseId: string;
  quizName?: string;
  quizId?: string;
  navigationPath: string;
}

export const searchApi = {
  search: async (query: string): Promise<ApiResponse<{ results: SearchResult[]; counts: { materials: number; questions: number; objectives: number; total: number } }>> => {
    return await apiClient.get(`/search?q=${encodeURIComponent(query)}`);
  }
};

// Export the API client for other services
export { apiClient };