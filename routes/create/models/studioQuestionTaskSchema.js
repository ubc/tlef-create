import mongoose from 'mongoose';

export default new mongoose.Schema({
  id: { type: String, required: true, maxlength: 120 }, focus: { type: String, required: true, maxlength: 180 },
  instructions: { type: String, required: true, maxlength: 1800 }, sourceIds: [{ type: String, maxlength: 100 }],
  visualRequirement: { type: String, enum: ['none'], default: 'none' }
}, { _id: false });
