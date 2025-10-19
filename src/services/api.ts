// API Service Layer for TLEF-CREATE Backend Integration
import { API_URL } from '../config/api';

const API_BASE = API_URL;

// Types for API responses
export interface ApiResponse<T = any> {
  success?: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
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
    }>;
    difficulty: 'easy' | 'moderate' | 'hard';
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

  async post<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: any): Promise<T> {
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

  // For file uploads (multipart/form-data)
  async upload<T>(endpoint: string, formData: FormData): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const config: RequestInit = {
      method: 'POST',
      credentials: 'include', // Include session cookies for SAML auth
      body: formData,
      // Don't set Content-Type header - let browser set it for multipart/form-data
    };

    try {
      console.log('🔄 API Upload request:', { url, method: config.method });
      const response = await fetch(url, config);
      console.log('📡 API Upload response:', { 
        status: response.status, 
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      // Handle different response types
      const contentType = response.headers.get('content-type');
      let data: any;
      
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      console.log('📦 API Upload data:', data);

      if (!response.ok) {
        // Backend returns structured error responses
        if (data && typeof data === 'object' && data.error) {
          console.log('❌ Structured error response:', data.error);
          throw new ApiError(data.error.message, response.status, data.error.code, data.error.details);
        } else if (data && typeof data === 'object' && data.data && data.data.errors && data.data.errors.length > 0) {
          // Handle file upload errors array
          console.log('❌ File upload errors:', data.data.errors);
          const firstError = data.data.errors[0];
          const errorMessage = firstError.error || 'File upload failed';
          throw new ApiError(`Upload failed: ${errorMessage}`, response.status, 'FILE_UPLOAD_ERROR', data.data.errors);
        } else {
          console.log('❌ Generic error response:', data);
          throw new ApiError(`HTTP ${response.status}: ${response.statusText}`, response.status);
        }
      }

      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      
      // Network or other errors
      console.error('API Upload failed:', error);
      throw new ApiError('Network error or server unavailable', 0);
    }
  }
}

// Custom error class for API errors
export class ApiError extends Error {
  public status: number;
  public code?: string;
  public details?: any;

  constructor(message: string, status: number, code?: string, details?: any) {
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
  uploadFiles: async (folderId: string, files: FileList): Promise<{ materials: Material[] }> => {
    const formData = new FormData();
    formData.append('folderId', folderId);
    
    // Add all files to FormData
    Array.from(files).forEach(file => {
      formData.append('files', file);
    });

    const response = await apiClient.upload<{ success: boolean; data: { materials: Material[] }; message: string }>('/materials/upload', formData);
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
  getQuizProgress: async (id: string): Promise<{ progress: any }> => {
    const response = await apiClient.get<{ success: boolean; data: { progress: any }; message: string }>(`/quizzes/${id}/progress`);
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
  generateObjectives: async (quizId: string, materialIds: string[], targetCount?: number): Promise<{ objectives: LearningObjective[] }> => {
    const response = await apiClient.post<{ success: boolean; data: { objectives: LearningObjective[] }; message: string }>('/objectives/generate', { quizId, materialIds, targetCount });
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
  deleteObjective: async (id: string): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ success: boolean; message: string }>(`/objectives/${id}`);
    return { message: response.message };
  },

  // POST /api/create/objectives/:id/regenerate - Regenerate single objective
  regenerateSingleObjective: async (id: string): Promise<{ objective: LearningObjective }> => {
    const response = await apiClient.post<{ success: boolean; data: { objective: LearningObjective }; message: string }>(`/objectives/${id}/regenerate`, {});
    return response.data;
  },

  // DELETE /api/create/objectives/quiz/:quizId/all - Delete all objectives for a quiz
  deleteAllObjectives: async (quizId: string): Promise<{ deletedCount: number; quizId: string }> => {
    console.log('🟡 API deleteAllObjectives called with quizId:', quizId);
    console.log('🟡 Making DELETE request to:', `/objectives/quiz/${quizId}/all`);
    
    try {
      const response = await apiClient.delete<{ success: boolean; data: { deletedCount: number; quizId: string }; message: string }>(`/objectives/quiz/${quizId}/all`);
      console.log('🟡 API deleteAllObjectives response:', response);
      return response.data;
    } catch (error) {
      console.error('🟡 API deleteAllObjectives error:', error);
      console.error('🟡 Error response:', error.response?.data);
      console.error('🟡 Error status:', error.response?.status);
      throw error;
    }
  },
};

// Generation Plan API
export const plansApi = {
  // POST /api/create/plans/generate - Generate AI plan for quiz
  generatePlan: async (quizId: string, approach: 'support' | 'assess' | 'gamify' | 'custom', questionsPerLO: number = 3, customFormula?: any): Promise<{ plan: GenerationPlan }> => {
    const requestData: any = { 
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

// Question API
export const questionsApi = {
  // GET /api/create/questions/quiz/:quizId - Get quiz questions
  getQuestions: async (quizId: string): Promise<{ questions: Question[] }> => {
    const response = await apiClient.get<{ questions: Question[] }>(`/questions/quiz/${quizId}`);
    return response.data; // API client already unwraps to just the data object
  },

  // POST /api/create/questions/generate-from-plan - Generate questions from approved plan
  generateFromPlan: async (quizId: string): Promise<{ questions: Question[]; metadata: any }> => {
    const response = await apiClient.post<any>('/questions/generate-from-plan', { quizId });
    return response.data; // API client already unwraps to just the data object
  },

  // POST /api/create/streaming/generate-questions - Start streaming question generation
  generateQuestionsStreaming: async (
    quizId: string, 
    questionConfigs: any[], 
    generationPlan?: any
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
    content?: any;
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
  correctAnswer: any;
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

  downloadExport: async (exportId: string): Promise<Blob> => {
    return await apiClient.getBlob(`/export/${exportId}/download`);
  }
};

// Export the API client for other services
export { apiClient };