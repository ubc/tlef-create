import mongoose from 'mongoose';
import { MATERIAL_CLASSIFICATIONS } from '../services/studioTeachingBrief.js';

const string = max => ({ type: String, maxlength: max });
const objective = new mongoose.Schema({ id: string(100), text: string(500), sourceIds: [string(100)],
  grounding: { type: String, enum: ['material-grounded', 'instructor-brief'] } }, { _id: false });
const material = new mongoose.Schema({ id: string(100), name: string(255),
  format: { type: String, enum: ['pdf', 'docx', 'url', 'text', 'unknown'] },
  classification: { type: String, enum: MATERIAL_CLASSIFICATIONS }, basis: { type: String, enum: ['metadata', 'text-excerpts', 'uncertain'] },
  readStatus: { type: String, enum: ['sampled', 'not-read'] }, sourceCount: { type: Number, min: 0 }, sourceIds: [string(100)] }, { _id: false });
const assumption = new mongoose.Schema({ key: string(80), value: string(500), reason: string(500),
  provenance: { type: String, enum: ['default', 'inferred'] } }, { _id: false });
export default new mongoose.Schema({ version: { type: Number, enum: [1], required: true },
  grounding: { type: String, enum: ['material-grounded', 'instructor-brief'], required: true }, summary: string(1000),
  materials: [material], objectives: [objective], assumptions: [assumption],
  scope: { topics: [string(300)], exclusions: [string(300)], coverage: { type: String, enum: ['sampled', 'instructor-brief', 'not-read'] } },
  visualSupport: { type: String, enum: ['text-only', 'none'] }
}, { _id: false });
