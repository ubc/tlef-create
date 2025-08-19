# TLEF-CREATE: AI-Powered Quiz Generator

**Next-generation quiz generator for modern education powered by UBC GenAI Toolkit**

This is the main application combining both frontend (React + TypeScript) and backend (Node.js + Express) for TLEF-CREATE, an intelligent quiz generation platform that uses AI, RAG (Retrieval-Augmented Generation), and SAML authentication.

![TLEF-CREATE](https://img.shields.io/badge/TLEF-CREATE-blue?style=for-the-badge)
![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react&style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&style=flat-square)

## 🚀 Quick Start

### Prerequisites
- Node.js 20.x or higher
- **Ollama** with Llama 3.1 8B model (see [AI Setup](#-ai-setup))
- Access to required external services (see [Dependencies](#-external-dependencies))

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
# Copy the example environment file to create your local configuration
cp .env.example .env

# Edit .env with your specific configuration
# The .env.example file contains all required variables with default values
# Update database URLs, SAML settings, and other environment-specific values as needed
nano .env  # or use your preferred editor (VS Code: code .env)
```

### 3. Start Development
```bash
# Frontend only (Vite dev server)
npm run dev

# Backend only (API server)
npm run dev:backend

# Production build
npm run build
npm start
```

**Access the application:**
- **Frontend**: http://localhost:8092
- **Backend API**: http://localhost:8051/api/create
- **Ollama API**: http://localhost:11434 (for AI features)

## 📁 External Dependencies

This application requires the following external repositories/services to function properly:

### 🔐 SAML Authentication Service
**Repository Required:** `docker-simple-saml`
- **Purpose**: SAML 2.0 authentication for UBC CWL login
- **Required Port**: 8080
- **GitHub URL**: https://github.com/fanxiaotuGod/docker-simple-saml/tree/tlef-create-integration
- **Setup**: Clone the `tlef-create-integration` branch and run with docker-compose
- **Test Accounts**: 
  - Faculty: `faculty` / `faculty`
  - Student: `student` / `student`

### 📊 MongoDB Database
**Repository Required:** `tlef-mongodb-docker`
- **Purpose**: Main application database with user data, quizzes, materials
- **Required Port**: 27017
- **GitHub URL**: https://github.com/fanxiaotuGod/tlef-mongodb-docker/tree/tlef-create-integration
- **Setup**: Clone the `tlef-create-integration` branch with auto-configured database
- **Features**: 
  - MongoDB 7.0 Community Server
  - Mongo Express web UI (port 8081)
  - Auto-creates `tlef-app` user with credentials
- **Web Interface**: http://localhost:8081 (admin/tlef2024express)

### 🔍 Vector Database
**Repository Required:** `tlef-qdrant`
- **Purpose**: Vector database for AI/RAG features (semantic search and content retrieval)
- **Required Ports**: 6333 (HTTP), 6334 (gRPC)
- **GitHub URL**: https://github.com/ubc/tlef-qdrant
- **Features**: 
  - Qdrant v1.14.1 Vector Database
  - API Key authentication: `super-secret-dev-key`
  - Web UI dashboard
- **Web Interface**: http://localhost:6333/dashboard

## 🤖 AI Setup

### Install Ollama and Llama 3.1 8B Model

**Step 1: Install Ollama**

**macOS/Linux:**
```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Or using Homebrew on macOS
brew install ollama
```

**Windows:**
```powershell
# Download and install from https://ollama.com/download/windows
# Or use winget
winget install Ollama.Ollama
```

**Step 2: Start Ollama Service**
```bash
# Start Ollama server (runs on port 11434 by default)
ollama serve
```

**Step 3: Download Llama 3.1 8B Model**
```bash
# Pull the Llama 3.1 8B model (this will take several minutes)
ollama pull llama3.1:8b

# Verify the model is installed
ollama list
```

**Step 4: Test Ollama Connection**
```bash
# Test basic functionality
ollama run llama3.1:8b "Hello, can you help me create quiz questions?"

# Test API endpoint (what the application uses)
curl http://localhost:11434/api/tags
```

### Ollama Configuration

**Default Configuration:**
- **API Endpoint**: `http://localhost:11434` 
- **Model**: `llama3.1:8b`
- **Port**: 11434 (can be customized)

**Custom Configuration (Optional):**

If you need to run Ollama on a different port or host:

```bash
# Set custom port in environment
export OLLAMA_HOST=0.0.0.0:11435

# Then update your .env file:
OLLAMA_ENDPOINT=http://localhost:11435
OLLAMA_MODEL=llama3.1:8b
```

**Environment Variables:**
```bash
# .env file configuration
OLLAMA_ENDPOINT=http://localhost:11434  # Ollama API endpoint
OLLAMA_MODEL=llama3.1:8b               # Default model to use
```

**System Requirements for Ollama:**
- **RAM**: 8GB+ (16GB recommended for Llama 3.1 8B)
- **Storage**: 5GB for the model file
- **CPU/GPU**: Works on CPU, GPU acceleration available for NVIDIA/AMD

**Troubleshooting Ollama:**
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Check Ollama logs
ollama logs

# Restart Ollama service
pkill ollama
ollama serve
```

### Setup Order
1. **Install Ollama and Llama model** (see [AI Setup](#-ai-setup))
2. **Clone and start MongoDB**: 
   ```bash
   git clone -b tlef-create-integration https://github.com/fanxiaotuGod/tlef-mongodb-docker.git
   cd tlef-mongodb-docker && docker-compose up -d
   ```
3. **Start Qdrant**: `cd ../tlef-qdrant && docker-compose up -d`
4. **Clone and start SAML**: 
   ```bash
   git clone -b tlef-create-integration https://github.com/fanxiaotuGod/docker-simple-saml.git
   cd docker-simple-saml && docker-compose up -d
   ```
5. **Start this application**: `npm run dev`

## 🎯 Application Features

### 🏠 Dashboard
**What it does:** Central hub showing course overview and statistics
- View all course folders created by the instructor
- Real-time statistics (total quizzes, questions, materials)
- Quick navigation to course management
- User account information and logout

### 📚 Course Management (CourseView)
**What it does:** Manage course folders and quizzes within a specific course
- Create and organize course folders (e.g., "CPSC 101", "Biology 200")
- View course-specific materials and quizzes
- Navigate to quiz creation workflow
- Delete or edit course information

### 🤖 AI-Powered Quiz Creation Workflow (QuizView)

The quiz creation process follows a structured 4-tab workflow:

#### Tab 1: Material Assignment (MaterialAssignment)
**What it does:** Upload and assign course materials that will be used for AI quiz generation

**Features:**
- **File Upload**: PDF, DOCX, TXT files (up to 100MB per file)
- **URL Materials**: Extract content from web pages automatically
- **Text Input**: Direct text content for immediate use
- **Material Preview**: View uploaded content before assignment
- **Smart Processing**: Automatic text extraction and content indexing

**AI Processing Behind the Scenes:**
- Document parsing and text extraction
- Content chunking for optimal AI processing
- Vector embedding generation for semantic search
- Storage in Qdrant vector database for RAG system

#### Tab 2: Learning Objectives (LearningObjectives)
**What it does:** Define or AI-generate learning objectives that quizzes will assess

**Three AI-Powered Input Methods:**

1. **Generate Mode**: AI creates objectives from assigned materials
   ```
   AI Prompt Used:
   "You are an educational expert helping to create learning objectives 
   for a university course. Based on the provided course materials, 
   generate [X] specific, measurable learning objectives that students 
   should achieve.
   
   Please generate learning objectives that:
   1. Use action verbs from Bloom's Taxonomy (analyze, evaluate, create, etc.)
   2. Are specific and measurable
   3. Align with the course content provided
   4. Are appropriate for university-level students
   5. Cover different aspects of the material
   
   Course Materials: [MATERIAL_CONTENT]
   
   Format each objective as: 'Students will be able to [action verb] [specific content/skill]'"
   ```

2. **Classify Mode**: AI organizes and formats user-provided objective text
   ```
   AI Prompt Used:
   "You are an educational expert. The user has provided text that contains 
   learning objectives. Please extract and classify them into individual, 
   well-formatted learning objectives.
   
   Rules:
   1. Each objective should be on its own line
   2. Use clear action verbs from Bloom's Taxonomy
   3. Make objectives specific and measurable
   4. Remove any numbering, bullets, or formatting
   5. Ensure each objective starts with 'Students will be able to' or similar
   
   Input text: [USER_INPUT]"
   ```

3. **Manual Mode**: Create custom learning objectives manually

**Features:**
- Real-time AI generation with progress indicators
- Edit individual objectives after generation
- Regenerate single objectives with AI
- Reorder objectives by drag-and-drop

#### Tab 3: Question Generation (QuestionGeneration)
**What it does:** Configure and execute AI-powered question generation

**Pedagogical Approaches:**
- **Support Learning**: Formative questions for skill building and practice
- **Assess Knowledge**: Summative questions for formal evaluation
- **Gamify Experience**: Interactive, engaging questions for motivation
- **Custom Approach**: User-defined strategy with flexible parameters

**AI Question Types Generated:**
- **Multiple Choice**: 4-option questions with detailed explanations
- **True/False**: Binary questions with justification
- **Flashcards**: Front/back card pairs for memorization
- **Summary Questions**: Open-ended questions requiring synthesis
- **Discussion Prompts**: Questions to stimulate class discussion
- **Matching**: Pair related concepts or terms
- **Ordering**: Arrange items in correct sequence
- **Cloze (Fill-in-blank)**: Complete sentences with missing terms

**RAG + LLM Architecture:**
```
Course Materials → Document Processing → Text Chunks
       ↓
Text Chunks → Vector Embeddings → Qdrant Vector Storage
       ↓
Learning Objective Query → RAG Retrieval → Most Relevant Content
       ↓
LLM (Ollama/Llama 3.1) + Retrieved Content → Generated Questions
```

**Question Generation Prompt Example:**
```
AI Prompt Used:
"You are an expert educator creating quiz questions. Generate [X] [question_type] 
questions for this learning objective using the provided content.

Learning Objective: [OBJECTIVE_TEXT]
Question Type: [TYPE]
Difficulty: [DIFFICULTY]
Pedagogical Approach: [APPROACH]

Relevant Content (Retrieved via RAG): [RAG_RETRIEVED_CONTENT]

Requirements:
1. Questions must directly assess the learning objective
2. Use the provided content as source material
3. Create realistic, challenging options for multiple choice
4. Ensure questions are clear and unambiguous
5. Provide detailed explanations for correct answers
6. Match the specified difficulty level
7. Align with the pedagogical approach

Format: Return valid JSON array with question objects"
```

#### Tab 4: Review & Edit (ReviewEdit)
**What it does:** Review, edit, and finalize AI-generated questions before export

**Features:**
- **Question Review**: View all generated questions with full details
- **Individual Editing**: Modify question text, options, and explanations
- **AI Regeneration**: Regenerate specific questions using AI
- **Manual Creation**: Add custom questions alongside AI-generated ones
- **Question Reordering**: Drag-and-drop to change question sequence
- **Export Options**: 
  - H5P format for Canvas LMS integration
  - JSON format for other systems
  - Preview mode for testing

## 🛠️ Technology Stack

### Frontend
- **React 18.3.1** with TypeScript for type safety
- **Vite** build tool and development server
- **Redux Toolkit** for state management
- **shadcn/ui** component library for consistent UI
- **Tailwind CSS** for utility-first styling
- **React Router** for client-side navigation
- **Lucide React** for icons

### Backend
- **Node.js** with Express.js framework
- **ES6 Modules** (type: "module") for modern JavaScript
- **Mongoose** MongoDB ODM with schema validation
- **Passport.js** with SAML strategy for authentication
- **Multer** for file upload handling
- **Express Session** for session management
- **Rate Limiting** for API protection

### AI & Machine Learning
- **UBC GenAI Toolkit** enterprise AI framework
- **Ollama** local LLM inference server (Llama 3.1 8B model)
- **Qdrant** vector database for semantic search
- **RAG Pipeline** (Retrieval-Augmented Generation)
- **Document Processing** with automatic text extraction
- **Vector Embeddings** for content similarity matching

### Database Layer
- **MongoDB 7.0** for structured data (users, quizzes, materials)
- **Qdrant 1.14.1** for vector storage and semantic search
- **Redis** (optional) for session caching and performance

## ⚙️ Configuration

### Environment Variables (.env.example → .env)

**First, copy the example file:**
```bash
cp .env.example .env
```

**Then configure your environment:**
```bash
# Server Configuration
PORT=8051
NODE_ENV=development

# Database Configuration
MONGODB_URI=mongodb://tlef-app:tlef-app-2024@localhost:27017/tlef-create
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=super-secret-dev-key

# Frontend Configuration
VITE_API_URL=http://localhost:8051
FRONTEND_URL=http://localhost:8092

# SAML Authentication
SAML_ENTRY_POINT=http://localhost:8080/simplesaml/saml2/idp/SSOService.php
SAML_LOGOUT_URL=http://localhost:8080/simplesaml/saml2/idp/SingleLogoutService.php
SAML_ISSUER=https://tlef-create
SAML_CALLBACK_URL=http://localhost:8051/api/create/auth/saml/callback
SAML_LOGOUT_CALLBACK_URL=http://localhost:8051/api/create/auth/logout/callback

# Session Configuration
SESSION_SECRET=your-session-secret-key-change-in-production

# AI Services (Ollama must be installed and running)
OLLAMA_ENDPOINT=http://localhost:11434     # Ollama API endpoint
OLLAMA_MODEL=llama3.1:8b                  # LLM model to use
RAG_SERVICE_URL=http://localhost:8000      # RAG service (future)
DOCUMENT_PARSER_URL=http://localhost:8001  # Document parser (future)

# File Upload Configuration
UPLOAD_DIR=./routes/create/uploads
MAX_FILE_SIZE=104857600
```

## 📊 API Endpoints

### Authentication (SAML-based)
- `GET /api/create/auth/saml/login` - Initiate SAML login
- `POST /api/create/auth/saml/callback` - Handle SAML response
- `GET /api/create/auth/me` - Get current user profile
- `GET /api/create/auth/logout` - SAML logout

### Core Application APIs
- `GET|POST /api/create/folders` - Course folder management
- `POST /api/create/materials/upload` - File upload with processing
- `POST /api/create/materials/url` - URL content extraction
- `POST /api/create/materials/text` - Direct text content
- `GET|POST /api/create/quizzes` - Quiz CRUD operations
- `POST /api/create/objectives/generate` - AI generate learning objectives
- `POST /api/create/objectives/classify` - AI classify user objectives
- `POST /api/create/plans/generate` - Generate question generation plan
- `POST /api/create/questions/generate-from-plan` - AI generate questions
- `GET /api/create/export/h5p/:quizId` - Export quiz to H5P format

## 🧪 Testing

```bash
# Run all backend tests
npm test

# Run with coverage report
npm run test:coverage

# Run in watch mode for development
npm run test:watch
```

**Test Coverage:**
- ✅ SAML authentication flow tests
- ✅ API endpoint integration tests
- ✅ Unit tests for utilities and helpers
- ⚠️ Some integration tests need SAML session updates

## 🚀 Development

### Development Mode
```bash
# Start frontend dev server (with hot reload)
npm run dev                 # → http://localhost:8092

# Start backend API server
npm run dev:backend         # → http://localhost:8051
```

### Production Mode
```bash
# Build frontend for production
npm run build

# Start combined server (serves both frontend + backend)
npm run start               # → http://localhost:8051

# Staging deployment with production build
npm run staging
```

## 📦 Build & Deployment

### Frontend Build Process
- Vite builds React app to `dist/` folder
- TypeScript compiled to optimized JavaScript
- Assets bundled, minified, and optimized
- Source maps generated for debugging

### Backend Deployment
- Node.js server serves built frontend from `dist/`
- API routes available under `/api/create`
- Static file serving handles SPA routing
- Production optimizations applied

### Environment-Specific Behavior
- **Development**: Vite dev server + separate API server
- **Production**: Single Node.js server serves everything
- **Staging**: Production build with staging environment variables

## 🔐 Authentication Flow

1. **User Access**: User visits application at http://localhost:8092
2. **Login Redirect**: Application detects no authentication, shows login page
3. **SAML Initiation**: User clicks "Sign in with UBC CWL", redirects to SAML IdP
4. **Authentication**: SAML IdP (SimpleSAMLphp) authenticates user credentials
5. **SAML Response**: IdP returns signed SAML response to callback URL
6. **Session Creation**: Application validates SAML response, creates user session
7. **Dashboard Access**: User redirected to dashboard with authenticated session

**Test Accounts (for development):**
- **Faculty**: Username `faculty`, Password `faculty`
- **Student**: Username `student`, Password `student`

## 📊 Database Schema

### Key Models
- **User**: CWL authentication, usage statistics, session management
- **Folder**: Course containers for organizing materials and quizzes
- **Material**: Uploaded files (PDF/DOCX), URLs, text content with processing status
- **Quiz**: Quiz configuration, settings, and workflow state
- **LearningObjective**: AI-generated or user-defined learning goals
- **Question**: Generated questions with metadata, explanations, and sources
- **GenerationPlan**: AI generation strategy and question distribution configuration

## 🛠️ Troubleshooting

### Common Issues

**Application Won't Start:**
```bash
# Ensure you have copied and configured your .env file
ls -la .env .env.example

# Check if required external services are running
curl http://localhost:27017  # MongoDB (should return connection info)
curl http://localhost:6333   # Qdrant (should return API response)
curl http://localhost:8080   # SAML IdP (should return HTML page)

# Check application health
curl http://localhost:8051/api/create/health
```

**Authentication Issues:**
- Verify SAML service is running on port 8080
- Check SAML callback URLs match your .env configuration
- Ensure SESSION_SECRET is set and consistent
- Clear browser cookies if switching between environments

**AI Features Not Working:**
- **Ollama Issues**: 
  ```bash
  # Check if Ollama is running
  curl http://localhost:11434/api/tags
  
  # Check if Llama 3.1 8B model is installed
  ollama list | grep llama3.1:8b
  
  # Restart Ollama if needed
  pkill ollama && ollama serve
  ```
- Check Qdrant connection and API key validity
- Check file upload permissions in `./routes/create/uploads/`
- Review vector database indexing status

**File Upload Issues:**
- Ensure `UPLOAD_DIR` exists and is writable
- Check `MAX_FILE_SIZE` against your file sizes
- Verify supported file types (PDF, DOCX, TXT)
- Check disk space availability

**Build Issues:**
```bash
# Clear caches and reinstall
rm -rf node_modules package-lock.json dist
npm install

# Rebuild from scratch
npm run build
```

**Database Connection Issues:**
```bash
# Test MongoDB connection
mongosh "mongodb://tlef-app:tlef-app-2024@localhost:27017/tlef-create"

# Test Qdrant connection
curl -H "api-key: super-secret-dev-key" http://localhost:6333/collections
```

**External Repository Versions:**
This application uses pre-configured forks of the external repositories:

**docker-simple-saml (tlef-create-integration branch):**
- ✅ SAML SP configuration for localhost:8051 callback URLs
- ✅ Updated docker-compose.yml for proper networking  
- ✅ UBC CLF theme integration
- ✅ Ready-to-use with TLEF-CREATE

**tlef-mongodb-docker (tlef-create-integration branch):**  
- ✅ Added mongo-init.js script to auto-create `tlef-app` user
- ✅ Database initialization for TLEF-CREATE schema
- ✅ Pre-configured for immediate use

Clone the specific branches shown in the setup instructions for seamless integration.

## 🤝 Contributing

### Development Guidelines
1. Follow TypeScript strict mode and ESLint standards
2. Add comprehensive tests for new features
3. Update API documentation for new endpoints
4. Test with all required external services running
5. Follow conventional commit format for git messages
6. Add JSDoc comments for complex functions

### Code Quality Tools
- **ESLint**: Code linting and style enforcement
- **TypeScript**: Static type checking
- **Jest**: Unit and integration testing
- **Prettier**: Code formatting (if configured)

### Pull Request Process
1. Create feature branch from main
2. Implement changes with tests
3. Verify all external services work
4. Update documentation as needed
5. Submit PR with clear description

## 📞 Support & Documentation

- **External Services Setup**: Check individual repository READMEs
- **Database Configuration**: See `DATABASE-SETUP.md` in project root
- **Deployment Guide**: See `DEPLOYMENT.md` in project root
- **SAML Configuration**: Check SAML service documentation
- **API Reference**: Review controller files in `routes/create/controllers/`
- **AI Prompts**: Review service files in `routes/create/services/`

## 🔗 Related Repositories

Related GitHub Repositories:
- [x] **docker-simple-saml** - https://github.com/ubc/docker-simple-saml
- [x] **tlef-mongodb-docker** - https://github.com/ubc/tlef-mongodb-docker  
- [x] **tlef-qdrant** - https://github.com/ubc/tlef-qdrant

---

**⚠️ Important**: This application requires all external dependencies to be running. Ensure you have set up and started the MongoDB, Qdrant, and SAML services before running the application.

**🎓 Built for UBC educators with ❤️ by the TLEF-CREATE team**