import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../routes/create/models/User.js';
import Folder from '../routes/create/models/Folder.js';
import Quiz from '../routes/create/models/Quiz.js';
import '../routes/create/models/Question.js';
import '../routes/create/models/LearningObjective.js';
import H5PContent from '../routes/create/models/H5PContent.js';
import { buildNativeH5PDocument } from '../routes/create/services/h5pExportService.js';
import {
  buildH5PSourceFingerprint,
  getH5PSourceUpdatedAt,
  saveNativeH5PDocumentAndRecord
} from '../routes/create/services/h5pEditorService.js';
import {
  finalizeContentOwnership,
  getEditor,
  getSystemUser,
  initializeLumi,
  toLumiUser
} from '../routes/create/services/lumiService.js';

const COURSE_NAME = 'H5P Renderer Comparison';
const USER_CWL = process.env.QA_CWL_ID
  || process.env.ADMIN_CWLS?.split(',').map(value => value.trim()).find(Boolean)
  || 'faculty';

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI);
  const owner = await User.findOne({ cwlId: USER_CWL });
  if (!owner) throw new Error(`Local QA user ${USER_CWL} was not found.`);
  const folder = await Folder.findOne({ instructor: owner._id, name: COURSE_NAME });
  if (!folder) throw new Error(`Course ${COURSE_NAME} was not found.`);

  const quizzes = await Quiz.find({
    folder: folder._id,
    name: /^H5P Comparison · (Column|Standalone)/
  }).populate({ path: 'questions', options: { sort: { order: 1 } } })
    .populate('learningObjectives');

  await initializeLumi();
  const editor = getEditor();
  const user = toLumiUser(owner);
  const drafts = [];

  for (const quiz of quizzes) {
    const existing = await H5PContent.findOne({ owner: owner._id, quiz: quiz._id, source: 'generated' })
      .sort({ updatedAt: -1 });
    if (existing) {
      drafts.push({ quizId: String(quiz._id), contentId: existing.lumiContentId, reused: true });
      continue;
    }

    const document = await buildNativeH5PDocument(quiz);
    const saved = await saveNativeH5PDocumentAndRecord({
      editor,
      document,
      user,
      cleanupUser: getSystemUser(),
      createRecord: result => H5PContent.create({
        owner: owner._id,
        folder: folder._id,
        quiz: quiz._id,
        lumiContentId: result.id,
        title: (result.metadata.title || quiz.name).slice(0, 255),
        mainLibrary: result.metadata.mainLibrary || document.library.split(' ')[0],
        source: 'generated',
        status: 'draft',
        sourceQuizUpdatedAt: getH5PSourceUpdatedAt(quiz),
        sourceFingerprint: buildH5PSourceFingerprint(quiz),
        lastEditedAt: new Date()
      })
    });
    finalizeContentOwnership(saved.result.id);
    drafts.push({ quizId: String(quiz._id), contentId: saved.result.id, reused: false });
  }

  console.log(JSON.stringify({ courseId: String(folder._id), drafts }, null, 2));
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
